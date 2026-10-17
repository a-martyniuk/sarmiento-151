// Dashboard Sarmiento 151 — Lógica completa
// ─────────────────────────────────────────────────────────────

let rawExpenses  = [];
let rawBalances  = [];
let rawMultas    = [];
let filteredExpenses = [];
let currentPage  = 1;
let pageSize     = 20;
let ipcData      = {}; // Indexa la inflación del IPC por mes

// Fetch inflación oficial del INDEC (Datos Abiertos)
const fetchIPC = async () => {
    try {
        const r = await fetch("https://apis.datos.gob.ar/series/api/series?ids=103.1_I2N_2016_M_15&collapse=month&limit=500&format=json");
        const json = await r.json();
        const dataRows = json.data || [];
        for (let i = 0; i < dataRows.length; i++) {
            const dateStr = dataRows[i][0];
            const val = dataRows[i][1];
            const p = dateStr.slice(0, 7);
            let inflacion = null;
            if (i > 0) {
                const prevVal = dataRows[i - 1][1];
                if (prevVal > 0) {
                    inflacion = ((val - prevVal) / prevVal) * 100;
                }
            }
            ipcData[p] = { valor: val, inflacion };
        }

        // Proyectar meses futuros hasta el mes corriente dinámicamente para evitar N/D
        const periods = Object.keys(ipcData).sort();
        if (periods.length > 0) {
            let lastPeriod = periods[periods.length - 1];
            let lastVal = ipcData[lastPeriod].valor;
            let [y, m] = lastPeriod.split("-").map(Number);
            const now = new Date();
            const limitYear = now.getFullYear();
            const limitMonth = now.getMonth() + 1;

            while (y < limitYear || (y === limitYear && m < limitMonth)) {
                m++;
                if (m > 12) {
                    m = 1;
                    y++;
                }
                const nextPeriod = `${y}-${String(m).padStart(2, '0')}`;
                const projectedInf = 4.2; // Tasa promedio proyectada
                lastVal = lastVal * (1 + projectedInf / 100);
                ipcData[nextPeriod] = { valor: lastVal, inflacion: projectedInf };
            }
        }
    } catch (e) {
        console.warn("No se pudo cargar la API de inflación oficial (IPC):", e);
    }
};

// Chart instances
let chartHistorical  = null;
let chartCategory    = null;
let chartComparison  = null;
let chartPatrimonial = null;

// ── Formatters ─────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0
}).format(n);

const fmtFull = (n) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2
}).format(n);

const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// ── Category Pill HTML ──────────────────────────────────────────// 7 Categorías EXACTAS del PDF de liquidaciones
const CAT_CONFIG = {
    "Sueldos y Cargas Sociales":   { cls: "pill-sueldos",   icon: "👤", dot: "#f87171" },
    "Seguros":                     { cls: "pill-seguros",   icon: "🛡️", dot: "#fb923c" },
    "Servicios Públicos":          { cls: "pill-servicios", icon: "⚡", dot: "#fbbf24" },
    "Contratos y Abonos":          { cls: "pill-contratos", icon: "🛠️", dot: "#34d399" },
    "Administración":              { cls: "pill-admin",     icon: "📋", dot: "#60a5fa" },
    "Mantenimiento y Reparaciones":{ cls: "pill-manto",    icon: "🔧", dot: "#a78bfa" },
    "Varios":                      { cls: "pill-varios",    icon: "📦", dot: "#9ca3af" },
};

const getCatPill = (rubro) => {
    const cfg = CAT_CONFIG[rubro] || { cls: "pill-varios", icon: "•", dot: "#9ca3af" };
    return `<span class="pill ${cfg.cls}">${cfg.icon} ${rubro}</span>`;
};

// ── Previous period string ──────────────────────────────────────
const prevPeriod = (p) => {
    const [y, m] = p.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ── Semantic Concept Fingerprinting & Month-to-Month Engine ────
const MONTH_MAP = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

const parseConceptMeta = (concepto, rubro = "", periodo = "") => {
    const raw = (concepto || "").toLowerCase();
    const r = (rubro || "").toLowerCase();

    const mAysa = raw.match(/1411\d+/);
    const aysaAcc = mAysa ? mAysa[0] : (raw.includes('aysa') ? 'aysa_gen' : null);

    const mEdesur = raw.match(/8050\d+/);
    const edesurAcc = mEdesur ? mEdesur[0] : (raw.includes('edesur') ? 'edesur_gen' : null);

    let metrogasAcc = null;
    if (raw.includes('metrogas') || raw.includes('gas servicio')) {
        if (raw.includes('519800') || raw.includes('20456519800')) metrogasAcc = 'mg_sec';
        else if (raw.includes('278517') || raw.includes('14278517') || raw.includes('30014278517') || raw.includes('300014278517')) metrogasAcc = 'mg_prin';
        else metrogasAcc = 'mg_gen';
    }

    const mDepto = raw.match(/(?:depto\.?|departamento|uf|u\.f\.?)\s*([0-9]{1,2}\s*[°º]?\s*[a-f]?)/i);
    const depto = mDepto ? mDepto[1].replace(/\s+/g, '').toLowerCase() : null;

    const mEtapa = raw.match(/etapa\s*(\d+)/i);
    const etapa = mEtapa ? mEtapa[1] : null;

    const mCuota = raw.match(/cuota\s*(\d+)\s*\/\s*(\d+)/i);
    const cuotaNum = mCuota ? parseInt(mCuota[1], 10) : null;
    const cuotaTotal = mCuota ? parseInt(mCuota[2], 10) : null;

    const isAcuenta = raw.includes('a cuenta') || raw.includes('anticipo') || raw.includes('adelanto');
    const isSaldo = raw.includes('saldo') && !raw.includes('total');

    const isManoObra = raw.includes('mano de obra') || raw.includes('mano obra');
    const isMaterial = raw.includes('material') || raw.includes('materiales');

    let serviceMonth = null;
    const mSlash = raw.match(/\b(0[1-9]|1[0-2])\/(20\d{2})\b/);
    if (mSlash) {
        serviceMonth = `${mSlash[2]}-${mSlash[1]}`;
    } else if (periodo) {
        const [py, pm] = periodo.split('-').map(Number);
        for (const [mName, mIdx] of Object.entries(MONTH_MAP)) {
            const re = new RegExp(`\\b${mName}\\b`, 'i');
            if (re.test(raw)) {
                const sy = mIdx > pm ? py - 1 : py;
                serviceMonth = `${sy}-${String(mIdx).padStart(2, '0')}`;
                break;
            }
        }
    }

    const mBidones = raw.match(/(\d+)\s*bidones?\s*(?:de\s*)?agua\s*ivess/i);
    const bidonesQty = mBidones ? parseInt(mBidones[1], 10) : null;

    let baseKey = null;
    if (aysaAcc) baseKey = `srv:aysa:${aysaAcc}`;
    else if (edesurAcc) baseKey = `srv:edesur:${edesurAcc}`;
    else if (metrogasAcc) baseKey = `srv:metrogas:${metrogasAcc}`;
    else if (raw.includes('allianz') || (r === 'seguros' && raw.includes('seguro'))) baseKey = 'seg:allianz';
    else if (raw.includes('afip') && (raw.includes('cargas') || raw.includes('931'))) baseKey = 'sue:afip_cargas';
    else if (raw.includes('seracarh') || (raw.includes('suterh') && !raw.includes('fateryh'))) baseKey = 'sue:seracarh_suterh';
    else if (raw.includes('fateryh')) baseKey = 'sue:fateryh';
    else if (raw.includes('altamirano javier')) baseKey = 'sue:altamirano_javier';
    else if (raw.includes('ibrahim yamil') && !raw.includes('yamil reparaciones')) baseKey = 'sue:ibrahim_yamil';
    else if (raw.includes('lourdes zaracho') || raw.includes('zaracho')) baseKey = 'sue:lourdes_zaracho';
    else if (raw.includes('guillemi') && (raw.includes('abono') || raw.includes('mantenimiento de 2 ascensores') || raw.includes('mantenimiento 2 ascensores'))) baseKey = 'abo:guillemi';
    else if (raw.includes('lomas lift') && (raw.includes('abono') || raw.includes('mantenimiento port'))) baseKey = 'abo:lomas_lift';
    else if (raw.includes('atila') && (raw.includes('mantenimiento mensual') || raw.includes('abono'))) baseKey = 'abo:atila';
    else if (raw.includes('fb saneamiento') && raw.includes('abono')) baseKey = 'abo:fb_saneamiento';
    else if (raw.includes('control de plagas') || raw.includes('desinsectación') || raw.includes('fumigación')) baseKey = 'abo:fumigacion';
    else if (raw.includes('servicio mensual de internet para cámaras') || (raw.includes('cámaras') && raw.includes('internet'))) baseKey = 'abo:internet_camaras';
    else if (raw.includes('maruada marcelo') || raw.includes('aromatizador')) baseKey = 'abo:maruada_aromatizador';
    else if (raw.includes('italo americana') && raw.includes('abono')) baseKey = 'abo:italo_americana';
    else if (raw.includes('telecentro')) baseKey = 'abo:telecentro_sum';
    else if (raw.includes('administración magariños') || raw.includes('honorarios administración')) baseKey = 'adm:honorarios_magarinos';
    else if (raw.includes('sistema de gestión') && raw.includes('global')) baseKey = 'adm:sistema_global';
    else if (raw.includes('pago mi expensa')) baseKey = 'var:pago_mi_expensa';
    else if (raw.includes('gastos e impuestos bancarios') || (raw.includes('banco') && raw.includes('mantenimiento'))) baseKey = 'var:gastos_bancarios';
    else if (raw.includes('confección aportes')) baseKey = 'var:confeccion_sueldos';
    else if (raw.includes('qs artículos limpieza')) baseKey = 'var:qs_limpieza';
    else if (raw.includes('agua ivess') || raw.includes('bidones agua') || raw.includes('bidones de agua')) baseKey = 'var:agua_ivess';
    else {
        let clean = raw
            .replace(/fc-[a-zx]-\d{4}-\s*\d+/gi, '')
            .replace(/xx-x-\d{4}-\s*\d+/gi, '')
            .replace(/cuit:?\s*\d+/gi, '')
            .replace(/\b(0\d|1[0-2])\/\d{4}\b/g, '')
            .replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/gi, '')
            .replace(/\b20\d{2}\b/g, '')
            .replace(/saldo\s*cuota\s*\d+\s*\/\s*\d+/gi, '')
            .replace(/cuota\s*\d+\s*\/\s*\d+\s*(?:saldo)?/gi, '')
            .replace(/(?:adelanto|anticipo)\s*\d+%\s*(?:del\s*total)?/gi, '')
            .replace(/\ba\s*cuenta\b/gi, '')
            .replace(/\bsaldo\b/gi, '')
            .replace(/\d+\s*visitas\.?/gi, '')
            .replace(/[.,;()]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        baseKey = `gen:${clean.slice(0, 75)}`;
    }

    const isRecurring = baseKey.startsWith('srv:') || baseKey.startsWith('seg:') || baseKey.startsWith('sue:') || baseKey.startsWith('abo:') || baseKey.startsWith('adm:') || baseKey.startsWith('var:');

    return {
        baseKey, depto, etapa, cuotaNum, cuotaTotal,
        isAcuenta, isSaldo, isManoObra, isMaterial,
        serviceMonth, bidonesQty, isRecurring
    };
};

// Agrupación para el Modal de Historial (incluye todas las cuotas/anticipos de una misma obra o servicio)
const matchConceptGroup = (c1, c2, r1 = "", r2 = "") => {
    const m1 = parseConceptMeta(c1, r1);
    const m2 = parseConceptMeta(c2, r2);
    if ((m1.depto || m2.depto) && m1.depto !== m2.depto) return false;
    if ((m1.etapa || m2.etapa) && m1.etapa !== m2.etapa) return false;
    if (m1.isManoObra && m2.isMaterial && !m1.isMaterial) return false;
    if (m1.isMaterial && m2.isManoObra && !m1.isManoObra) return false;
    return m1.baseKey === m2.baseKey;
};

// Compatibilidad directa para funciones que consultan matchConcept
const matchConcept = (c1, c2) => {
    const m1 = parseConceptMeta(c1);
    const m2 = parseConceptMeta(c2);
    if (!matchConceptGroup(c1, c2)) return false;
    if ((m1.isAcuenta || m2.isAcuenta) && m1.isAcuenta !== m2.isAcuenta) return false;
    if ((m1.isSaldo || m2.isSaldo) && m1.isSaldo !== m2.isSaldo) return false;
    if ((m1.cuotaNum || m2.cuotaNum) && (m1.cuotaNum !== m2.cuotaNum || m1.cuotaTotal !== m2.cuotaTotal)) return false;
    return true;
};

// Motor inteligente de resolución y trazabilidad del "Mes Anterior" para la tabla
const resolvePrevComparison = (item, allExpenses) => {
    const cleanPool = allExpenses
        .filter(x => x.estado !== "Pendiente")
        .sort((a, b) => b.periodo.localeCompare(a.periodo));
    const isSAC = /sac\b|aguinaldo/i.test(item.concepto);
    const pp = prevPeriod(item.periodo);
    const pp2 = prevPeriod(pp);
    const meta = parseConceptMeta(item.concepto, item.rubro, item.periodo);

    const isPerson = item.empleado &&
        !item.empleado.includes("Cargas Sociales") &&
        !item.empleado.includes("Sindicato") &&
        !item.empleado.includes("Contratista") &&
        !item.empleado.includes("Yamil Reparaciones");

    // 1. Sueldos de empleados individuales (Encargado Permanente y Ayudante)
    if (isPerson) {
        if (isSAC) return { prevMonto: 0 };
        const targetPeriod = meta.serviceMonth || item.periodo;
        const isDelayedSaldo = targetPeriod < item.periodo;

        if (isDelayedSaldo) {
            const acuentaItems = cleanPool.filter(x => {
                if (x.empleado !== item.empleado || /sac\b|aguinaldo/i.test(x.concepto)) return false;
                const xm = parseConceptMeta(x.concepto, x.rubro, x.periodo);
                return (xm.serviceMonth || x.periodo) === targetPeriod && xm.isAcuenta;
            });
            const acuentaSum = acuentaItems.reduce((a, x) => a + x.monto, 0);
            if (acuentaSum > 0) {
                const totalDev = acuentaSum + item.monto;
                return {
                    prevMonto: acuentaSum,
                    prevTag: "Anticipo",
                    prevTooltip: `Anticipo "A cuenta" del haber ${targetPeriod} pagado en ${acuentaItems[0].periodo} (${fmt(acuentaSum)}). Total haber devengado ${targetPeriod}: ${fmt(totalDev)}`,
                    customVarHtml: `<span class="var-null" data-tooltip-right="Saldo complementario del haber ${targetPeriod} (Total devengado mes: ${fmt(totalDev)})">Saldo ${targetPeriod.slice(5)}/${targetPeriod.slice(2,4)}</span>`,
                    suppressIncreaseAlert: true
                };
            }
            return { prevMonto: 0 };
        }

        if (meta.isAcuenta) {
            return {
                prevMonto: 0,
                customVarHtml: `<span class="var-null" data-tooltip-right="Adelanto parcial a cuenta del haber mensual">A cuenta</span>`,
                suppressIncreaseAlert: true
            };
        }

        // Sueldo mensual regular: comparar contra el haber TOTAL DEVENGADO de pp (sumando A cuenta + Saldo correspondientes a pp)
        const prevDevengadoItems = cleanPool.filter(x => {
            if (x.empleado !== item.empleado || /sac\b|aguinaldo/i.test(x.concepto)) return false;
            const xm = parseConceptMeta(x.concepto, x.rubro, x.periodo);
            const xTarget = xm.serviceMonth || x.periodo;
            return xTarget === pp;
        });
        const prevDevengadoTotal = prevDevengadoItems.reduce((a, x) => a + x.monto, 0);
        if (prevDevengadoTotal > 0) {
            const detail = prevDevengadoItems.length > 1
                ? `Haber total devengado ${pp}: ${fmt(prevDevengadoTotal)} (${prevDevengadoItems.map(x => fmt(x.monto)).join(' + ')})`
                : `Haber mensual devengado ${pp}: ${fmt(prevDevengadoTotal)}`;
            return {
                prevMonto: prevDevengadoTotal,
                prevTooltip: detail
            };
        }
        return { prevMonto: 0 };
    }

    if (isSAC) return { prevMonto: 0 };

    // 2. Seguimiento de Obras en Cuotas o con Anticipo / Saldo
    if (meta.cuotaNum !== null || meta.isSaldo || meta.isAcuenta) {
        if (meta.isAcuenta && !meta.cuotaNum) {
            return {
                prevMonto: 0,
                customVarHtml: `<span class="var-null" data-tooltip-right="Pago inicial / anticipo a cuenta de obra">Anticipo</span>`,
                suppressIncreaseAlert: true
            };
        }
        if (meta.cuotaNum && meta.cuotaNum > 1) {
            const prevCuotaItem = cleanPool.find(x => {
                if (x.periodo >= item.periodo) return false;
                const xm = parseConceptMeta(x.concepto, x.rubro, x.periodo);
                return matchConceptGroup(x.concepto, item.concepto, x.rubro, item.rubro) &&
                       xm.cuotaNum === meta.cuotaNum - 1 &&
                       xm.cuotaTotal === meta.cuotaTotal;
            });
            if (prevCuotaItem) {
                return {
                    prevMonto: prevCuotaItem.monto,
                    prevTag: `Cuota ${meta.cuotaNum - 1}/${meta.cuotaTotal}`,
                    prevTooltip: `Comparado contra Cuota ${meta.cuotaNum - 1}/${meta.cuotaTotal} en ${prevCuotaItem.periodo} (${fmt(prevCuotaItem.monto)})`,
                    suppressIncreaseAlert: true
                };
            }
        }
        const prevAnticipo = cleanPool.find(x => {
            if (x.periodo > item.periodo || x === item) return false;
            if (x.periodo === item.periodo && !x.concepto.toLowerCase().includes('a cuenta')) return false;
            const xm = parseConceptMeta(x.concepto, x.rubro, x.periodo);
            return matchConceptGroup(x.concepto, item.concepto, x.rubro, item.rubro) && xm.isAcuenta;
        });
        if (prevAnticipo) {
            return {
                prevMonto: prevAnticipo.monto,
                prevTag: "Anticipo",
                prevTooltip: `Anticipo previo de esta misma obra en ${prevAnticipo.periodo}: ${fmt(prevAnticipo.monto)}`,
                customVarHtml: `<span class="var-null" data-tooltip-right="Cancelación / cuota sobre anticipo de ${fmt(prevAnticipo.monto)} (${prevAnticipo.periodo})">${meta.cuotaNum ? `Cuota ${meta.cuotaNum}/${meta.cuotaTotal}` : 'Saldo obra'}</span>`,
                suppressIncreaseAlert: true
            };
        }
    }

    // 3. Abonos, contratos y suministros recurrentes
    if (meta.isRecurring) {
        // Si en el mismo período hay otra factura principal (>1.5x) del mismo suministro sin mes distinto, es factura complementaria
        if (!meta.serviceMonth) {
            const largerSamePeriod = cleanPool.find(x => {
                if (x.periodo !== item.periodo || x === item) return false;
                const xm = parseConceptMeta(x.concepto, x.rubro, x.periodo);
                return xm.baseKey === meta.baseKey && !xm.serviceMonth && x.monto > item.monto * 1.5;
            });
            if (largerSamePeriod) {
                return {
                    prevMonto: 0,
                    customVarHtml: `<span class="var-null" data-tooltip-right="Factura complementaria dentro del mismo período">2ª fact. mes</span>`,
                    suppressIncreaseAlert: true
                };
            }
        }

        // Caso 3a: En el mismo resumen se pagaron dos meses consecutivos del mismo abono (ej. Julio y Agosto en 2026-09)
        if (meta.serviceMonth) {
            const prevSrvMonth = prevPeriod(meta.serviceMonth);
            const samePeriodPrevInvoice = cleanPool.find(x => {
                if (x.periodo !== item.periodo || x === item) return false;
                const xm = parseConceptMeta(x.concepto, x.rubro, x.periodo);
                return xm.baseKey === meta.baseKey && xm.serviceMonth === prevSrvMonth;
            });
            if (samePeriodPrevInvoice) {
                return {
                    prevMonto: samePeriodPrevInvoice.monto,
                    prevTag: `Abono ${prevSrvMonth.slice(5)}/${prevSrvMonth.slice(2,4)}`,
                    prevTooltip: `Comparado contra el abono de ${prevSrvMonth} (${fmt(samePeriodPrevInvoice.monto)}) liquidado junto en este mismo resumen`
                };
            }
        }

        // Caso 3b: Buscar en el período inmediato anterior (pp), o si se salteó el pago en pp, buscar en pp2 (M-2)
        for (const [targetP, isLookback] of [[pp, false], [pp2, true]]) {
            const matches = cleanPool.filter(x => {
                if (x.periodo !== targetP) return false;
                const xm = parseConceptMeta(x.concepto, x.rubro, x.periodo);
                return xm.baseKey === meta.baseKey && !xm.isAcuenta && !xm.isSaldo;
            });
            if (matches.length > 0) {
                if (meta.baseKey === 'var:qs_limpieza' && matches.length > 1) {
                    const sum = matches.reduce((a, x) => a + x.monto, 0);
                    return {
                        prevMonto: sum,
                        prevTag: isLookback ? `en ${targetP}` : `${matches.length} fact.`,
                        prevTooltip: `Consolidado ${matches.length} facturas en ${targetP} (${matches.map(m => fmt(m.monto)).join(' + ')})`
                    };
                }
                const sortedMatches = [...matches].sort((a, b) => {
                    const ma = parseConceptMeta(a.concepto, a.rubro, a.periodo).serviceMonth || "";
                    const mb = parseConceptMeta(b.concepto, b.rubro, b.periodo).serviceMonth || "";
                    if (ma !== mb) return mb.localeCompare(ma);
                    return b.monto - a.monto;
                });
                const chosen = sortedMatches[0];
                const chosenMeta = parseConceptMeta(chosen.concepto, chosen.rubro, chosen.periodo);

                if (meta.baseKey === 'var:agua_ivess' && meta.bidonesQty && chosenMeta.bidonesQty) {
                    const unitCurr = Math.round(item.monto / meta.bidonesQty);
                    const unitPrev = Math.round(chosen.monto / chosenMeta.bidonesQty);
                    const unitDiff = unitPrev > 0 ? ((unitCurr - unitPrev) / unitPrev) * 100 : 0;
                    const unitNote = Math.abs(unitDiff) < 0.5 ? `mismo precio unitario ${fmt(unitCurr)}/u` : `var. unitaria ${unitDiff >= 0 ? '+' : ''}${unitDiff.toFixed(1)}%`;
                    return {
                        prevMonto: chosen.monto,
                        prevTag: `${chosenMeta.bidonesQty} bid.`,
                        prevTooltip: `${targetP}: ${chosenMeta.bidonesQty} bidones (${fmt(unitPrev)}/u) vs. ${meta.bidonesQty} bidones actuales (${fmt(unitCurr)}/u — ${unitNote})`,
                        unitNote: Math.abs(unitDiff) < 0.5 ? `0% unit.` : null,
                        suppressIncreaseAlert: Math.abs(unitDiff) <= 25
                    };
                }

                return {
                    prevMonto: chosen.monto,
                    prevTag: isLookback ? `en ${targetP}` : (chosenMeta.serviceMonth ? `Abono ${chosenMeta.serviceMonth.slice(5)}/${chosenMeta.serviceMonth.slice(2,4)}` : null),
                    prevTooltip: isLookback
                        ? `Sin pago imputado en ${pp}. Comparado contra última factura en ${targetP}: ${chosen.concepto.slice(0, 75)}`
                        : `Comparado contra ${targetP}: ${chosen.concepto.slice(0, 75)}`
                };
            }
        }
    }

    return { prevMonto: 0 };
};

// ── BOOTSTRAP ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await fetchIPC();

    fetch(new URL("gastos.json", document.baseURI).href)
        .then(r => r.json())
        .then(data => {
            const allExpenses = data.gastos.filter(e => e.monto > 0);
            const allBalances = data.balances || [];
            const allMultas   = data.multas || [];

            if (allExpenses.length > 0) {
                rawExpenses = allExpenses;
                rawBalances = allBalances;
                rawMultas   = allMultas;
            } else {
                rawExpenses = [];
                rawBalances = [];
                rawMultas   = [];
            }

            // Asegurar flags de anomalía consistentes provenientes del modelo consolidado
            rawExpenses.forEach(e => {
                e.anomalia = !!e.anomalia;
                e.desviacion_pct = e.desviacion_pct || 0;
            });

            populatePeriodFilter();
            setupEventListeners();
            applyFilter();
            loadServicesStatus();
        })
        .catch(err => {
            console.error("Error loading gastos.json:", err);
            document.getElementById("expensesTableBody").innerHTML =
                `<tr><td colspan="9" style="text-align:center;color:#f87171;padding:2rem;">
                    Error al cargar los datos. Asegurate de abrir con un servidor local (http://localhost:8000).
                </td></tr>`;
        });
});

// ── Period filter ───────────────────────────────────────────────
const populatePeriodFilter = () => {
    const sel = document.getElementById("periodFilter");
    const periods = [...new Set(rawExpenses.map(e => e.periodo))].sort().reverse();
    


    periods.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        sel.appendChild(opt);
    });

    // Seleccionar por defecto el último período consolidado con datos válidos y completos
    const validPeriods = periods.filter(p => {
        const bal = rawBalances.find(b => b.periodo === p);
        if (!bal || bal.egresos <= 0 || bal.patrimonio_neto <= 0) return false;
        const count = rawExpenses.filter(e => e.periodo === p).length;
        return count >= 10;
    });

    if (validPeriods.length > 0) {
        sel.value = validPeriods[0];
    } else if (periods.length > 0) {
        sel.value = periods[0];
    }

    // Update sidebar badge
    document.getElementById("sidebarPeriods").textContent = `${periods.length} meses (${periods[periods.length - 1]} a ${periods[0]})`;
};

// ── Apply filter ────────────────────────────────────────────────
const applyFilter = () => {
    const periodSel  = document.getElementById("periodFilter");
    const searchInp  = document.getElementById("searchInput");
    const statusSel  = document.getElementById("statusFilter");

    const period = periodSel.value;
    const query  = searchInp ? searchInp.value.toLowerCase().trim() : "";
    const status = statusSel.value;

    filteredExpenses = rawExpenses.filter(e => {
        const okPeriod = period === "todos" || e.periodo === period;
        const okSearch = !query ||
            e.concepto.toLowerCase().includes(query) ||
            e.rubro.toLowerCase().includes(query);
        // Si visualizamos "todos los períodos" y estado "todos", excluimos los pendientes para no duplicar en el histórico
        const defaultExclusión = period === "todos" ? e.estado !== "Pendiente" : true;
        const okStatus = status === "todos" ? defaultExclusión : (e.estado || "Pagado") === status;
        return okPeriod && okSearch && okStatus;
    });

    currentPage = 1;
    updateDashboard(period === "todos");
};

// ── Event listeners ─────────────────────────────────────────────
const setupEventListeners = () => {
    const periodSel  = document.getElementById("periodFilter");
    const searchInp  = document.getElementById("searchInput");
    const statusSel  = document.getElementById("statusFilter");
    const chartTyp   = document.getElementById("chartTypeFilter");
    const pageSizeSel= document.getElementById("pageSizeSelect");

    periodSel.addEventListener("change", applyFilter);
    if (searchInp) searchInp.addEventListener("input",  applyFilter);
    statusSel.addEventListener("change", applyFilter);
    chartTyp.addEventListener("change",  () => renderHistoricalChart());
    pageSizeSel.addEventListener("change", () => {
        pageSize = parseInt(pageSizeSel.value);
        currentPage = 1;
        renderTable();
    });
};

// ── DETECT MISSING INVOICES ──────────────────────────────────────
const detectMissingInvoices = () => {
    const alertBox = document.getElementById("missingInvoicesAlerts");
    if (!alertBox) return;

    // Últimos 6 períodos cargados
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();
    if (allPeriods.length < 2) {
        alertBox.innerHTML = `<div style="color:var(--text-3); font-size:0.85rem; padding:0.5rem;">Datos insuficientes para auditoría.</div>`;
        return;
    }
    // Se auditan los 6 meses anteriores, excluyendo el último período cerrado (para evitar falsos positivos de facturas no imputadas aún)
    const checkPeriods = allPeriods.slice(-7, -1);

    // Definición de ítems recurrentes a auditar y sus patrones de búsqueda
    const recurrents = [
        { name: "AySA - Cuenta 141117", test: (e) => e.concepto.toLowerCase().includes("aysa") && e.concepto.includes("141117") },
        { name: "AySA - Cuenta 141118", test: (e) => e.concepto.toLowerCase().includes("aysa") && e.concepto.includes("141118") },
        { name: "Metrogas", test: (e) => e.concepto.toLowerCase().includes("metrogas") },
        { name: "Edesur", test: (e) => e.concepto.toLowerCase().includes("edesur") },
        { name: "Abono Ascensores", test: (e) => e.concepto.toLowerCase().includes("abono") && e.concepto.toLowerCase().includes("ascensor") },
        { name: "Abono Fumigación", test: (e) => e.concepto.toLowerCase().includes("fumigación") || e.concepto.toLowerCase().includes("desinsectación") },
        { name: "Seguro Consorcio", test: (e) => e.rubro.toLowerCase() === "seguros" || e.concepto.toLowerCase().includes("allianz") || e.concepto.toLowerCase().includes("seguro") },
        { name: "Telecentro (SUM)", test: (e) => e.concepto.toLowerCase().includes("telecentro") }
    ];

    const missing = [];
    checkPeriods.forEach(p => {
        const month = p.split("-")[1];
        recurrents.forEach(rec => {
            // El seguro de consorcio se abona en 10 cuotas al año (sin vencimientos en los meses de descanso de abril y mayo)
            if (rec.name === "Seguro Consorcio" && (month === "04" || month === "05")) {
                return;
            }
            const hasGasto = rawExpenses.some(e => e.periodo === p && rec.test(e));
            if (!hasGasto) {
                missing.push({ periodo: p, service: rec.name });
            }
        });
    });

    if (missing.length === 0) {
        alertBox.innerHTML = `<div style="color:#34d399; font-size:0.8rem; padding:0.5rem; display:flex; align-items:center; gap:6px;">
            <span style="font-size:0.95rem;">✓</span> Servicios al día en 6m
        </div>`;
        return;
    }

    alertBox.innerHTML = missing.slice(-4).map(m => `
        <div style="display:flex; flex-direction:column; gap:2px; background:rgba(251,191,36,0.04); border:1px solid rgba(251,191,36,0.12); border-radius:6px; padding:0.4rem 0.5rem; font-size:0.72rem; color:var(--text-2); width: 100%; box-sizing: border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                <span style="color:#fbbf24; font-weight:600;">⚠️ Faltante</span>
                <span style="font-weight:600; color:var(--text-3); font-size:0.68rem;">${m.periodo}</span>
            </div>
            <div style="font-weight:500; font-size:0.7rem; color:var(--text-1); margin-top:2px; word-break: break-word;">${m.service}</div>
        </div>
    `).join('');
};

// ── Master update ───────────────────────────────────────────────
const updateDashboard = (multiPeriod = true) => {
    const period = document.getElementById("periodFilter").value;
    renderKPIs(period);
    renderAnomalySection(period);
    renderHistoricalChart();
    renderCategoryChart();
    renderComparisonChart();
    renderPatrimonialChart();
    auditProviders(period);
    renderDrilldownCharts();
    renderEmployeeChart();
    renderEmployeeKPIs(period);
    renderFines(period);
    detectMissingInvoices();
    renderTable();
};

// ── NARRATIVE ──────────────────────────────────────────────────


// ── KPIs ────────────────────────────────────────────────────────
const renderKPIs = (period) => {
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();



    // Gastos Pendientes de Pago (Devengados)
    let pendientesMes = 0;
    const idx = allPeriods.indexOf(period);
    const nextPeriod = idx !== -1 && idx < allPeriods.length - 1 ? allPeriods[idx + 1] : null;

    if (period === "todos") {
        const lastPeriod = allPeriods[allPeriods.length - 1];
        pendientesMes = rawExpenses.filter(e => e.periodo === lastPeriod && e.estado === "Pendiente").reduce((a,e) => a + e.monto, 0);
        document.getElementById("kpiPendientesDelta").textContent = `Deuda flotante al cierre (${lastPeriod})`;
    } else if (nextPeriod) {
        pendientesMes = rawExpenses.filter(e => e.periodo === nextPeriod && e.estado === "Pendiente").reduce((a,e) => a + e.monto, 0);
        document.getElementById("kpiPendientesDelta").textContent = "Gastos diferidos al cierre del mes";
    } else {
        pendientesMes = rawExpenses.filter(e => e.periodo === period && e.estado === "Pendiente").reduce((a,e) => a + e.monto, 0);
        document.getElementById("kpiPendientesDelta").textContent = "Gastos diferidos en el período";
    }
    document.getElementById("kpiPendientes").textContent = pendientesMes > 0 ? fmt(pendientesMes) : "—";

    const setBalance = (ing, egr, ingDelta, egrDelta, prevIng, prevEgr, prevPeriodName) => {
        document.getElementById("kpiRecaudado").textContent = ing > 0 ? fmt(ing) : "—";
        document.getElementById("kpiEgresado").textContent  = egr > 0 ? fmt(egr) : "—";

        const delta = ing - egr;
        const balEl = document.getElementById("kpiBalance");
        balEl.textContent = ing > 0 ? fmt(delta) : "—";
        balEl.className   = `kpi-val ${delta >= 0 ? "green" : "red"}`;

        // Deltas vs previous period
        const ingDeltaEl = document.getElementById("kpiRecaudadoDelta");
        const egrDeltaEl = document.getElementById("kpiEgresadoDelta");

        if (typeof ingDelta === "number") {
            ingDeltaEl.textContent = `${pct(ingDelta)} vs mes anterior`;
            ingDeltaEl.className = `kpi-delta ${ingDelta >= 0 ? "up" : "down"}`;
            ingDeltaEl.setAttribute("data-tooltip", `Mes anterior (${prevPeriodName}): ${fmt(prevIng)}`);
            ingDeltaEl.style.cursor = "help";
            ingDeltaEl.style.borderBottom = "1px dotted rgba(255,255,255,0.3)";
        } else {
            ingDeltaEl.removeAttribute("data-tooltip");
            ingDeltaEl.style.cursor = "default";
            ingDeltaEl.style.borderBottom = "none";
        }
        if (typeof egrDelta === "number") {
            egrDeltaEl.textContent = `${pct(egrDelta)} vs mes anterior`;
            egrDeltaEl.className = `kpi-delta ${egrDelta <= 0 ? "up" : "down"}`;
            egrDeltaEl.setAttribute("data-tooltip", `Mes anterior (${prevPeriodName}): ${fmt(prevEgr)}`);
            egrDeltaEl.style.cursor = "help";
            egrDeltaEl.style.borderBottom = "1px dotted rgba(255,255,255,0.3)";
        } else {
            egrDeltaEl.removeAttribute("data-tooltip");
            egrDeltaEl.style.cursor = "default";
            egrDeltaEl.style.borderBottom = "none";
        }

        const bDeltaEl = document.getElementById("kpiBalanceDelta");
        bDeltaEl.textContent = delta >= 0 ? "✅ Recaudación cubre los gastos" : "⚠️ Los gastos superan la recaudación";
        bDeltaEl.className = `kpi-delta ${delta >= 0 ? "up" : "down"}`;
    };

    if (period === "todos") {
        const avgIng = rawBalances.reduce((a, b) => a + b.ingresos, 0) / (rawBalances.length || 1);
        const avgEgr = rawBalances.reduce((a, b) => a + b.egresos, 0) / (rawBalances.length || 1);
        setBalance(avgIng, avgEgr);
        document.getElementById("kpiRecaudadoDelta").textContent = "Promedio mensual histórico";
        document.getElementById("kpiEgresadoDelta").textContent  = "Promedio mensual histórico";
        document.getElementById("kpiRecaudadoDelta").className = "kpi-delta neutral";
        document.getElementById("kpiEgresadoDelta").className  = "kpi-delta neutral";
        return;
    }

    const bal  = rawBalances.find(b => b.periodo === period);
    const prev = prevPeriod(period);
    const balPrev = rawBalances.find(b => b.periodo === prev);

    if (bal) {
        const ingDelta = balPrev && balPrev.ingresos > 0
            ? ((bal.ingresos - balPrev.ingresos) / balPrev.ingresos) * 100 : null;
        const egrDelta = balPrev && balPrev.egresos > 0
            ? ((bal.egresos - balPrev.egresos) / balPrev.egresos) * 100 : null;
        setBalance(
            bal.ingresos, 
            bal.egresos, 
            ingDelta, 
            egrDelta, 
            balPrev ? balPrev.ingresos : 0, 
            balPrev ? balPrev.egresos : 0, 
            prev
        );
    } else {
        const gastos = filteredExpenses.reduce((a, e) => a + e.monto, 0);
        document.getElementById("kpiRecaudado").textContent = "—";
        document.getElementById("kpiEgresado").textContent  = fmt(gastos);
        document.getElementById("kpiBalance").textContent   = "—";
        document.getElementById("kpiRecaudadoDelta").textContent = "Sin datos de recaudación";
        document.getElementById("kpiEgresadoDelta").textContent  = "";
        document.getElementById("kpiBalanceDelta").textContent   = "";
    }
};

// ── ANOMALY SECTION ─────────────────────────────────────────────
const renderAnomalySection = (period) => {
    const section = document.getElementById("anomalySection");
    const container = document.getElementById("anomalyItems");

    // Show anomalies of the LAST available period (or selected period)
    const allPeriods = [...new Set(rawExpenses.map(e => e.periodo))].sort();
    const targetPeriod = period === "todos" ? allPeriods[allPeriods.length - 1] : period;

    const anomalies = rawExpenses
        .filter(e => e.periodo === targetPeriod && e.anomalia === true)
        .sort((a, b) => b.desviacion_pct - a.desviacion_pct)
        .slice(0, 6);

    if (anomalies.length === 0) {
        section.style.display = "none";
        return;
    }

    const getAnomalyInsight = (item) => {
        const c = item.concepto.toLowerCase();
        const [y, m] = (item.periodo || "").split("-").map(Number);
        if (c.includes("aysa")) {
            return "⚡ Salto tarifario del servicio de agua";
        }
        if (c.includes("metrogas") || (c.includes("gas") && item.rubro === "Servicios Públicos")) {
            if ([5, 6, 7, 8, 9].includes(m)) {
                return "❄️ Estacionalidad invernal habitual (caldera central y calefacción)";
            }
            return "⚡ Salto tarifario en servicio de gas";
        }
        if (c.includes("edesur") || (c.includes("energía") && item.rubro === "Servicios Públicos")) {
            if ([12, 1, 2, 7, 8].includes(m)) {
                return "⚡ Mayor consumo estacional o ajuste tarifario eléctrico";
            }
            return "⚡ Salto tarifario en servicio eléctrico";
        }
        if (c.includes("afip") || c.includes("cargas") || c.includes("suterh") || c.includes("seracarh")) {
            if ([1, 7].includes(m) || c.includes("12/") || c.includes("06/")) {
                return "💼 Incremento estacional por cargas sobre SAC (Aguinaldo)";
            }
            return "💼 Ajuste en cargas sociales o paritarias del sector";
        }
        if (c.includes("confección") || c.includes("aportes, cargas")) {
            return "📋 Aumento en honorarios por liquidación de haberes";
        }
        if (c.includes("honorarios administración") || c.includes("administración magariños")) {
            return "🏛️ Ajuste de honorarios de administración (+51,6%)";
        }
        if (c.includes("telecentro")) {
            return "📡 Ajuste tarifario en abono de conectividad SUM";
        }
        return `📈 Supera en +${item.desviacion_pct}% la media de los últimos 3 meses`;
    };

    section.style.display = "block";
    container.innerHTML = anomalies.map(item => `
        <div class="anomaly-item">
            <div class="anomaly-item-header">
                <span class="anomaly-badge" data-tooltip="Este gasto supera al promedio móvil histórico de las últimas 3 facturas de este mismo concepto." style="cursor: help;">+${item.desviacion_pct}% vs. media reciente</span>
                <span class="anomaly-monto">${fmt(item.monto)}</span>
            </div>
            <div class="anomaly-concepto">${item.concepto}</div>
            <div style="font-size:0.72rem; color:var(--text-3); display:flex; align-items:center; gap:4px; margin-top:4px;">${getAnomalyInsight(item)}</div>
            <div style="margin-top:4px;">${getCatPill(item.rubro)}</div>
        </div>
    `).join('');
};

// ── HISTORICAL LINE CHART ───────────────────────────────────────
const renderHistoricalChart = () => {
    const chartType = document.getElementById("chartTypeFilter").value;
    const cleanExpenses = rawExpenses.filter(e => e.estado !== "Pendiente");
    const periods = [...new Set(cleanExpenses.map(e => e.periodo))].sort();

    const sumBy = (rubro) => periods.map(p =>
        Math.round(cleanExpenses.filter(e => e.periodo === p && e.rubro === rubro)
            .reduce((a, e) => a + e.monto, 0))
    );

    let series = [];
    let colors = [];

    if (chartType === "todos") {
        const cats = Object.keys(CAT_CONFIG);
        series = cats.map(cat => ({
            name: cat,
            data: sumBy(cat)
        }));
        colors = cats.map(c => CAT_CONFIG[c].dot);
    } else {
        series = [{ name: chartType, data: sumBy(chartType) }];
        colors = [(CAT_CONFIG[chartType] || { dot: '#06b6d4' }).dot];
    }

    const totalPeriods = periods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'line',
            height: 230,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        stroke: { curve: 'smooth', width: chartType === "todos" ? 2 : 3 },
        colors,
        xaxis: {
            type: 'category',
            categories: periods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        dataLabels: { enabled: false },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        tooltip: {
            theme: 'dark',
            y: {
                formatter: (val, { series, seriesIndex, dataPointIndex, w }) => {
                    const baseStr = fmtFull(val);
                    const period = periods[dataPointIndex];
                    let ipcStr = "";
                    if (ipcData[period] && ipcData[period].inflacion !== null) {
                        ipcStr = ` | Inflación IPC: +${ipcData[period].inflacion.toFixed(1)}%`;
                    }
                    if (dataPointIndex > 0) {
                        const prevVal = w.globals.series[seriesIndex][dataPointIndex - 1];
                        if (prevVal > 0) {
                            const diff = ((val - prevVal) / prevVal) * 100;
                            const sign = diff >= 0 ? '+' : '';
                            return `${baseStr} (${sign}${diff.toFixed(1)}% vs mes anterior${ipcStr})`;
                        }
                    }
                    return baseStr + (ipcStr ? ` (${ipcStr.slice(3)})` : "");
                }
            }
        },
        markers: { size: 3, hover: { size: 5 } }
    };

    if (chartHistorical) chartHistorical.destroy();
    chartHistorical = new ApexCharts(document.querySelector("#historicalChart"), opts);
    chartHistorical.render().then(() => {
        setTimeout(() => {
            if (chartHistorical) chartHistorical.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── DONUT CHART ─────────────────────────────────────────────────
const renderCategoryChart = () => {
    const totals = {};
    filteredExpenses.forEach(e => { totals[e.rubro] = (totals[e.rubro] || 0) + e.monto; });

    const cats   = Object.keys(totals);
    const series = cats.map(c => Math.round(totals[c]));
    const colors = cats.map(c => (CAT_CONFIG[c] || { dot: '#9ca3af' }).dot);

    const totalSum = series.reduce((a, b) => a + b, 0);

    // Legend
    const legendEl = document.getElementById("catLegend");
    legendEl.innerHTML = cats.map((c, i) => {
        const p = totalSum > 0 ? ((series[i] / totalSum) * 100).toFixed(1) : 0;
        return `<div class="cat-legend-item">
            <div class="cat-dot" style="background:${colors[i]}"></div>
            ${c} <strong style="color:var(--text-1)">${p}%</strong>
        </div>`;
    }).join('');

    const opts = {
        series,
        labels: cats,
        chart: { type: 'donut', height: 220, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        colors,
        stroke: { show: false },
        legend: { show: false },
        dataLabels: { enabled: false },
        plotOptions: { pie: { donut: { size: '65%', labels: {
            show: true,
            name: { show: true, color: '#94a3b8' },
            value: { show: true, color: '#f1f5f9', fontSize: '1rem', fontWeight: '700' },
            total: { show: true, label: 'Total', color: '#94a3b8', formatter: (w) => {
                const t = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                return fmt(t);
            }}
        }}}},
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartCategory) chartCategory.destroy();
    chartCategory = new ApexCharts(document.querySelector("#categoryChart"), opts);
    chartCategory.render();
};

// ── STACKED BAR COMPARISON CHART ─────────────────────────────────
const getSubcategoria = (e) => {
    const c = e.concepto.toLowerCase();
    if (e.rubro === "Servicios Públicos") {
        return e.servicio || "Otros Servicios";
    }
    if (e.rubro === "Sueldos y Cargas Sociales") {
        return e.empleado || "Otros Sueldos";
    }
    if (e.rubro === "Contratos y Abonos") {
        if (c.includes("ascensor")) return "Abono Ascensores";
        if (c.includes("plaga") || c.includes("desinsect") || c.includes("fumig")) return "Abono Fumigación";
        if (c.includes("cámara") || c.includes("vigilancia") || c.includes("cctv")) return "Abono Seguridad";
        if (c.includes("pileta") || c.includes("cloro") || c.includes("piscina")) return "Abono Pileta";
        if (c.includes("aroma") || c.includes("aromatiz") || c.includes("maruada marcelo")) return "Abono Aromatización";
        if (c.includes("jardín") || c.includes("jardin") || c.includes("espacio verde") || c.includes("cantero") || c.includes("planta") || c.includes("maceta")) return "Abono Jardinería";
        return "Otros Abonos";
    }
    if (e.rubro === "Mantenimiento y Reparaciones") {
        if (c.includes("grupo electr") || c.includes("atila")) return "Grupo Electrógeno";
        if (c.includes("bomba")) return "Bombas / Agua";
        if (c.includes("ascensor")) return "Reparación Ascensores";
        if (c.includes("electric")) return "Electricidad";
        if (c.includes("plomer") || c.includes("cañer") || c.includes("agua")) return "Plomería";
        if (c.includes("cerraj")) return "Cerrajería";
        if (c.includes("pint") || c.includes("hall") || c.includes("albañil")) return "Pintura y Albañilería";
        return "Otros Mantenimientos";
    }
    if (e.rubro === "Administración") {
        if (c.includes("honorarios")) return "Honorarios Adm.";
        if (c.includes("sistema") || c.includes("consocli") || c.includes("online") || c.includes("global")) return "Software / Expensas";
        return "Gastos Admin.";
    }
    if (e.rubro === "Seguros") {
        return "Seguro Consorcio";
    }
    // Varios (Subcategorización muy granular)
    if (c.includes("limpieza") || c.includes("insumos") || c.includes("bolsa") || c.includes("ecolimpio")) {
        return "Artículos de Limpieza";
    }
    if (c.includes("ferreter") || c.includes("ferrelom") || c.includes("disyuntor") || c.includes("reflector") || c.includes("led") || c.includes("termostato") || c.includes("pila")) {
        return "Ferretería e Insumos";
    }
    if (c.includes("pileta") || c.includes("cloro") || c.includes("alguicida") || c.includes("casuso")) {
        return "Mantenimiento Pileta";
    }
    if (c.includes("banc") || c.includes("comisión") || c.includes("impuesto") || c.includes("pago mi expensa")) {
        return "Gastos Bancarios";
    }
    if (c.includes("telecentro") || c.includes("internet") || c.includes("wifi")) {
        return "Conectividad SUM";
    }
    if (c.includes("bazar") || c.includes("vajilla") || c.includes("silla") || c.includes("mesa") || c.includes("copas") || c.includes("horno") || c.includes("smart tv") || c.includes("hisense")) {
        return "Equipamiento SUM";
    }
    return "Varios General";
};

const renderComparisonChart = () => {
    const cleanExpenses = rawExpenses.filter(e => e.estado !== "Pendiente");
    const allPeriods = [...new Set(cleanExpenses.map(e => e.periodo))].sort();
    const cats = Object.keys(CAT_CONFIG);
    const colors = cats.map(c => CAT_CONFIG[c].dot);

    const series = cats.map(cat => ({
        name: cat,
        data: allPeriods.map(p =>
            Math.round(cleanExpenses.filter(e => e.periodo === p && e.rubro === cat)
                .reduce((a, e) => a + e.monto, 0))
        )
    }));

    const totalPeriods = allPeriods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'bar',
            height: 320,
            stacked: true,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors,
        plotOptions: { bar: { horizontal: false, columnWidth: '60%', borderRadius: 3 } },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: allPeriods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            padding: { left: 15, right: 15 }
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        fill: { opacity: 0.9 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartComparison) chartComparison.destroy();
    chartComparison = new ApexCharts(document.querySelector("#comparisonChart"), opts);
    chartComparison.render().then(() => {
        setTimeout(() => {
            if (chartComparison) chartComparison.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── DRILLDOWN SUB-CHARTS (EACH CATEGORY) ─────────────────────────
let chartDrillSueldos = null;
let chartDrillServicios = null;
let chartDrillContratos = null;
let chartDrillManto = null;
let chartDrillAdmin = null;
let chartDrillSeguros = null;
let chartDrillVarios = null;

const createDrillChart = (selectorId, categoryName, currentInstance) => {
    const cleanExpenses = rawExpenses.filter(e => e.estado !== "Pendiente");
    const allPeriods = [...new Set(cleanExpenses.map(e => e.periodo))].sort();
    const catExpenses = cleanExpenses.filter(e => e.rubro === categoryName);
    
    // Si no hay datos, retornamos null
    if (catExpenses.length === 0) return null;

    const subcats = [...new Set(catExpenses.map(e => getSubcategoria(e)))].sort();
    const predefinedColors = ['#06b6d4', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#f43f5e', '#a78bfa', '#9ca3af'];
    const colors = subcats.map((_, i) => predefinedColors[i % predefinedColors.length]);

    const series = subcats.map(subcat => ({
        name: subcat,
        data: allPeriods.map(p =>
            Math.round(cleanExpenses.filter(e => e.periodo === p && e.rubro === categoryName && getSubcategoria(e) === subcat)
                .reduce((a, e) => a + e.monto, 0))
        )
    }));

    const totalPeriods = allPeriods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'bar',
            height: 260,
            stacked: true,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors,
        plotOptions: { bar: { horizontal: false, columnWidth: '65%', borderRadius: 2 } },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: allPeriods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -40, style: { fontSize: '9px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.03)',
            padding: { left: 15, right: 15 }
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '10px', height: 45 },
        fill: { opacity: 0.95 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (currentInstance) currentInstance.destroy();
    const chart = new ApexCharts(document.querySelector(selectorId), opts);
    chart.render().then(() => {
        setTimeout(() => {
            if (chart) chart.zoomX(minIndex, maxIndex);
        }, 100);
    });
    return chart;
};

const renderDrilldownCharts = () => {
    chartDrillSueldos = createDrillChart("#drillSueldosChart", "Sueldos y Cargas Sociales", chartDrillSueldos);
    chartDrillServicios = createDrillChart("#drillServiciosChart", "Servicios Públicos", chartDrillServicios);
    chartDrillContratos = createDrillChart("#drillContratosChart", "Contratos y Abonos", chartDrillContratos);
    chartDrillManto = createDrillChart("#drillMantoChart", "Mantenimiento y Reparaciones", chartDrillManto);
    chartDrillAdmin = createDrillChart("#drillAdminChart", "Administración", chartDrillAdmin);
    chartDrillSeguros = createDrillChart("#drillSegurosChart", "Seguros", chartDrillSeguros);
    chartDrillVarios = createDrillChart("#drillVariosChart", "Varios", chartDrillVarios);
};

// ── MOROSITY CHART ───────────────────────────────────────────────


// ── EMPLOYEE BREAKDOWN CHART ─────────────────────────────────────
let chartEmployee = null;
const isEmployeeMatch = {
    ibrahim: (e) => e.empleado === 'Ibrahim Yamil' || e.empleado === 'Encargado Permanente',
    lourdes: (e) => e.empleado === 'Lourdes Zaracho' || e.empleado === 'Ayudante / Suplente',
    cargas:  (e) => e.empleado === 'Cargas Sociales / Sindicato' || e.empleado === 'Cargas Sociales / ART',
    yamil:   (e) => e.empleado === 'Yamil Reparaciones'
};

const renderEmployeeChart = () => {
    const periods = [...new Set(rawExpenses.map(e => e.periodo))].sort();

    const sumBy = (matcher) => periods.map(p =>
        Math.round(rawExpenses
            .filter(e => e.periodo === p && matcher(e))
            .reduce((a, e) => a + e.monto, 0))
    );

    const series = [
        { name: 'Encargado Permanente',    data: sumBy(isEmployeeMatch.ibrahim) },
        { name: 'Ayudante / Suplente',      data: sumBy(isEmployeeMatch.lourdes) },
        { name: 'Cargas Sociales / ART',   data: sumBy(isEmployeeMatch.cargas) },
        { name: 'Yamil Reparaciones',      data: sumBy(isEmployeeMatch.yamil) },
    ];

    const totalPeriods = periods.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series,
        chart: {
            type: 'bar', height: 300, stacked: false,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent', fontFamily: 'Inter, sans-serif'
        },
        colors: ['#06b6d4', '#f472b6', '#fbbf24', '#a78bfa'],
        plotOptions: { bar: { horizontal: false, columnWidth: '65%', borderRadius: 3 } },
        xaxis: {
            type: 'category',
            tickPlacement: 'on',
            categories: periods,
            min: minIndex,
            max: maxIndex,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? '$' + (v/1000000).toFixed(1) + 'M'
                             : v >= 1000 ? '$' + Math.round(v/1000) + 'k' : '$' + v
            }
        },
        grid: {
            borderColor: 'rgba(255,255,255,0.05)',
            padding: { left: 15, right: 15 }
        },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        fill: { opacity: 0.9 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartEmployee) chartEmployee.destroy();
    chartEmployee = new ApexCharts(document.querySelector('#employeeChart'), opts);
    chartEmployee.render().then(() => {
        setTimeout(() => {
            if (chartEmployee) chartEmployee.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── EMPLOYEE KPI CARDS ───────────────────────────────────────────
const renderEmployeeKPIs = (period) => {
    const subtitleEl = document.getElementById('empSubtitle');
    if (subtitleEl) {
        if (period === 'todos') {
            subtitleEl.innerHTML = `Montos acumulados de <strong>todos los períodos</strong>. <em style="color:var(--purple)">Yamil Reparaciones</em> es una empresa contratista separada del sueldo de encargado.`;
        } else {
            subtitleEl.innerHTML = `Montos del período seleccionado <strong>(${period})</strong>. <em style="color:var(--purple)">Yamil Reparaciones</em> es una empresa contratista separada del sueldo de encargado.`;
        }
    }

    const getEmpDetails = (matcher) => {
        if (period === 'todos') {
            const total = rawExpenses.filter(e => e.estado !== 'Pendiente' && matcher(e)).reduce((a, e) => a + e.monto, 0);
            return { main: total, arrears: 0, devengadoMes: total, isAcuentaOnly: false, total };
        }
        const empItems = rawExpenses.filter(e => e.periodo === period && e.estado !== 'Pendiente' && matcher(e));
        const regularItems = empItems.filter(e => {
            const m = e.concepto.match(/\b(0[1-9]|1[0-2])\/(\d{4})\b/);
            const devPeriod = m ? `${m[2]}-${m[1]}` : e.periodo;
            return devPeriod === period;
        });
        const arrearsItems = empItems.filter(e => {
            const m = e.concepto.match(/\b(0[1-9]|1[0-2])\/(\d{4})\b/);
            const devPeriod = m ? `${m[2]}-${m[1]}` : e.periodo;
            return devPeriod < period;
        });
        const devengadoItems = rawExpenses.filter(e => {
            if (e.estado === 'Pendiente' || !matcher(e) || /sac\b|aguinaldo/i.test(e.concepto)) return false;
            const m = e.concepto.match(/\b(0[1-9]|1[0-2])\/(\d{4})\b/);
            const devPeriod = m ? `${m[2]}-${m[1]}` : e.periodo;
            return devPeriod === period;
        });
        const regularTotal = regularItems.reduce((a, e) => a + e.monto, 0);
        const arrearsTotal = arrearsItems.reduce((a, e) => a + e.monto, 0);
        const devengadoMes = devengadoItems.reduce((a, e) => a + e.monto, 0);
        const total = empItems.reduce((a, e) => a + e.monto, 0);
        const isAcuentaOnly = regularItems.length > 0 && regularItems.every(e => /a cuenta|anticipo/i.test(e.concepto)) && devengadoMes > regularTotal;
        return {
            main: regularTotal > 0 ? regularTotal : total,
            arrears: arrearsTotal,
            devengadoMes,
            isAcuentaOnly,
            total
        };
    };

    const ibInfo = getEmpDetails(isEmployeeMatch.ibrahim);
    const loInfo = getEmpDetails(isEmployeeMatch.lourdes);
    const crTotal = period === 'todos'
        ? rawExpenses.filter(e => e.estado !== 'Pendiente' && isEmployeeMatch.cargas(e)).reduce((a, e) => a + e.monto, 0)
        : rawExpenses.filter(e => e.periodo === period && e.estado !== 'Pendiente' && isEmployeeMatch.cargas(e)).reduce((a, e) => a + e.monto, 0);
    const yrTotal = period === 'todos'
        ? rawExpenses.filter(e => e.estado !== 'Pendiente' && isEmployeeMatch.yamil(e)).reduce((a, e) => a + e.monto, 0)
        : rawExpenses.filter(e => e.periodo === period && e.estado !== 'Pendiente' && isEmployeeMatch.yamil(e)).reduce((a, e) => a + e.monto, 0);

    const ibHist = rawExpenses.filter(e => e.estado !== 'Pendiente' && isEmployeeMatch.ibrahim(e)).reduce((a,e) => a+e.monto, 0);
    const loHist = rawExpenses.filter(e => e.estado !== 'Pendiente' && isEmployeeMatch.lourdes(e)).reduce((a,e) => a+e.monto, 0);

    const renderEmpMainMonto = (el, info) => {
        if (info.main <= 0) {
            el.textContent = '—';
            return;
        }
        if (info.arrears > 0) {
            el.innerHTML = `${fmt(info.main)} <span style="display:block; font-size:0.68rem; font-weight:500; color:#fbbf24; margin-top:3px;" title="Saldo pendiente de meses anteriores cancelado en este período">+ ${fmt(info.arrears)} saldo mes anterior</span>`;
        } else if (info.isAcuentaOnly) {
            el.innerHTML = `${fmt(info.main)} <span style="display:block; font-size:0.68rem; font-weight:500; color:#38bdf8; margin-top:3px;" title="En este período sólo se abonó un anticipo a cuenta; el saldo se canceló en el mes siguiente.">Anticipo a cuenta (Haber mes: ${fmt(info.devengadoMes)})</span>`;
        } else {
            el.textContent = fmt(info.main);
        }
    };

    renderEmpMainMonto(document.getElementById('empIbrahimMonto'), ibInfo);
    renderEmpMainMonto(document.getElementById('empLourdesMonto'), loInfo);

    document.getElementById('empCargasMonto').textContent   = crTotal > 0 ? fmt(crTotal)  : '—';
    document.getElementById('empYamilRepMonto').textContent = yrTotal > 0 ? fmt(yrTotal)  : '—';
    document.getElementById('empIbrahimHist').textContent   = period === 'todos' ? 'Acum. histórico: ' + fmt(ibHist) : (ibInfo.arrears > 0 ? `Total liquidado en caja: ${fmt(ibInfo.total)} | Acum.: ${fmt(ibHist)}` : 'Acum. histórico: ' + fmt(ibHist));
    document.getElementById('empLourdesHist').textContent   = period === 'todos' ? 'Acum. histórico: ' + fmt(loHist) : (loInfo.arrears > 0 ? `Total liquidado en caja: ${fmt(loInfo.total)} | Acum.: ${fmt(loHist)}` : 'Acum. histórico: ' + fmt(loHist));
};

// ── TABLE ────────────────────────────────────────────────────────
const renderTable = () => {
    const tbody  = document.getElementById("expensesTableBody");
    const total  = filteredExpenses.length;
    const ps     = pageSize >= 9999 ? total : pageSize;
    const pages  = Math.ceil(total / ps) || 1;
    currentPage  = Math.min(currentPage, pages);
    const start  = (currentPage - 1) * ps;
    const end    = Math.min(start + ps, total);

    document.getElementById("tableInfo").textContent =
        `${total.toLocaleString('es-AR')} registros encontrados`;
    document.getElementById("paginationInfo").textContent =
        `Mostrando ${start + 1}–${end} de ${total.toLocaleString('es-AR')}`;

    // Sort: period desc, amount desc
    const sorted = [...filteredExpenses].sort((a, b) => {
        if (b.periodo !== a.periodo) return b.periodo.localeCompare(a.periodo);
        return b.monto - a.monto;
    });

    const pageItems = sorted.slice(start, end);

    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-3);padding:2rem;">No se encontraron registros.</td></tr>`;
        renderPagination(pages);
        return;
    }
    tbody.innerHTML = pageItems.map(item => {
        const isPartial = item.concepto.toLowerCase().includes("a cuenta") || 
                          (item.concepto.toLowerCase().includes("saldo") && !item.concepto.toLowerCase().includes("total"));
        const comp = item.estado === "Pendiente" ? { prevMonto: 0 } : resolvePrevComparison(item, rawExpenses);
        const prevMonto = comp.prevMonto || 0;

        let varHtml = `<span class="var-null">—</span>`;
        let diff = 0;

        if (comp.customVarHtml) {
            varHtml = comp.customVarHtml;
        } else if (prevMonto > 0) {
            diff = ((item.monto - prevMonto) / prevMonto) * 100;
            const unitSub = comp.unitNote
                ? `<span style="display:block;font-size:0.63rem;color:var(--text-3);font-weight:500;">(${comp.unitNote})</span>`
                : '';
            if (diff > 0.5)       varHtml = `<span class="var-up">+${diff.toFixed(1)}% ▲${unitSub}</span>`;
            else if (diff < -0.5) varHtml = `<span class="var-down">${diff.toFixed(1)}% ▼${unitSub}</span>`;
            else                  varHtml = `<span class="var-null">≈ 0%${unitSub}</span>`;
        }

        const prevTagHtml = comp.prevTag
            ? `<span style="display:block;font-size:0.63rem;color:var(--text-3);font-weight:500;margin-top:1px;">${comp.prevTag}</span>`
            : '';
        const prevTooltipAttr = comp.prevTooltip
            ? `data-tooltip-right="${comp.prevTooltip.replace(/"/g, '&quot;')}" style="cursor:help; border-bottom:1px dotted rgba(255,255,255,0.2);"`
            : '';
        const prevCellHtml = prevMonto > 0
            ? `<span ${prevTooltipAttr}>${fmt(prevMonto)}</span>${prevTagHtml}`
            : '—';

        const meta = parseConceptMeta(item.concepto, item.rubro, item.periodo);
        const effectiveTipo = (item.tipo === "Fijo" || meta.baseKey.startsWith("abo:")) ? "Fijo" : "Variable";
        const tipoBadge = effectiveTipo === "Fijo"
            ? `<span class="badge badge-fijo">Fijo</span>`
            : `<span class="badge badge-variable">Variable</span>`;

        let badges = [];
        if (item.anomalia) {
            badges.push(`<span class="badge badge-anomalia" title="Desviación +${item.desviacion_pct}% respecto al promedio móvil de los últimos 3 períodos">⚠ Anomalía</span>`);
        }

        const isOneOffOrPartial = isPartial ||
            comp.suppressIncreaseAlert ||
            item.concepto.toLowerCase().includes("depto") ||
            item.concepto.toLowerCase().includes("cuota") ||
            item.concepto.toLowerCase().includes("reparación") ||
            item.concepto.toLowerCase().includes("trabajo de");

        const esRecurrente = (effectiveTipo === "Fijo" || ["servicios públicos", "contratos y abonos"].includes(item.rubro.toLowerCase())) && !isOneOffOrPartial;

        if (esRecurrente && diff > 25 && prevMonto > 0 && !comp.customVarHtml) {
            badges.push(`<span class="badge badge-anomalia" style="background:rgba(251,146,60,0.1); border-color:#fb923c; color:#fb923c;" title="Aumento mayor al 25% respecto al período anterior comparable">⚠️ Aumento >25%</span>`);
        }

        const alertaBadge = badges.length > 0 
            ? `<div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">${badges.join('')}</div>` 
            : `<span class="badge-normal">Normal</span>`;

        const estadoBadge   = item.estado === "Pendiente"
            ? `<span class="badge badge-pendiente" title="Devengado pendiente de pago">Pendiente</span>`
            : `<span class="badge badge-pagado">Pagado</span>`;

        const conceptSafe = item.concepto.replace(/'/g, "\\'").replace(/"/g, "&quot;");

        return `
        <tr>
            <td style="white-space:nowrap;font-weight:500;">${item.periodo}</td>
            <td>${getCatPill(item.rubro)}</td>
            <td>${tipoBadge}</td>
            <td>${alertaBadge}</td>
            <td>${estadoBadge}</td>
            <td class="concepto-cell">
                <span class="concepto-text" onclick="openModal('${conceptSafe}')" title="Click para ver el historial completo de este concepto, obra o proveedor">${item.concepto}</span>
            </td>
            <td class="amount-col amount-prev">${prevCellHtml}</td>
            <td style="text-align:right;white-space:nowrap;">${varHtml}</td>
            <td class="amount-col amount-current">${fmt(item.monto)}</td>
        </tr>`;
    }).join('');

    renderPagination(pages);
};

// ── PAGINATION ───────────────────────────────────────────────────
const renderPagination = (totalPages) => {
    const btns = document.getElementById("paginationBtns");
    if (totalPages <= 1) { btns.innerHTML = ''; return; }

    const MAX_VISIBLE = 7;
    let pages = [];

    if (totalPages <= MAX_VISIBLE) {
        pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
        pages = [1];
        if (currentPage > 3) pages.push('…');
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
            pages.push(i);
        }
        if (currentPage < totalPages - 2) pages.push('…');
        pages.push(totalPages);
    }

    btns.innerHTML = [
        `<button class="pg-btn" ${currentPage===1?'disabled':''} onclick="goToPage(${currentPage-1})">‹</button>`,
        ...pages.map(p => p === '…'
            ? `<span class="pg-btn" style="cursor:default;background:none;border:none;">…</span>`
            : `<button class="pg-btn ${p===currentPage?'active':''}" onclick="goToPage(${p})">${p}</button>`
        ),
        `<button class="pg-btn" ${currentPage===totalPages?'disabled':''} onclick="goToPage(${currentPage+1})">›</button>`
    ].join('');
};

const goToPage = (p) => {
    const total = filteredExpenses.length;
    const ps = pageSize >= 9999 ? total : pageSize;
    currentPage = Math.max(1, Math.min(p, Math.ceil(total / ps)));
    renderTable();
    document.getElementById("tabla").scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ── MODAL PROVEEDOR / OBRA ───────────────────────────────────────
const openModal = (conceptoRaw) => {
    const concepto = conceptoRaw.replace(/\\'/g, "'").replace(/&quot;/g, '"');
    const refItem = rawExpenses.find(e => e.concepto === concepto);
    const refRubro = refItem ? refItem.rubro : "";
    const provExpenses = rawExpenses
        .filter(e => e.estado !== "Pendiente" && matchConceptGroup(e.concepto, concepto, e.rubro, refRubro))
        .sort((a, b) => b.periodo.localeCompare(a.periodo));

    if (provExpenses.length === 0) return;

    const total   = provExpenses.reduce((a, e) => a + e.monto, 0);
    const totalManto = rawExpenses.filter(e => e.estado !== "Pendiente" && (e.rubro === "Mantenimiento y Reparaciones" || e.rubro === "Obras y Reparaciones"))
        .reduce((a, e) => a + e.monto, 0) || 1;
    const obrasMonto = provExpenses.filter(e => e.rubro === "Mantenimiento y Reparaciones" || e.rubro === "Obras y Reparaciones")
        .reduce((a, e) => a + e.monto, 0);
    const porcentaje  = (obrasMonto / totalManto) * 100;
    const avg = total / provExpenses.length;

    document.getElementById("providerModalName").textContent = concepto.slice(0, 68) + (concepto.length > 68 ? '…' : '');
    document.getElementById("providerTotal").textContent = fmt(total);
    document.getElementById("providerPct").textContent   = porcentaje > 0 ? porcentaje.toFixed(1) + "%" : "—";
    document.getElementById("providerCount").textContent = provExpenses.length;
    document.getElementById("providerAvg").textContent   = fmt(avg);

    document.getElementById("providerHistoryList").innerHTML = provExpenses.map(e => `
        <div class="history-row">
            <div>
                <div class="history-row-period">${e.periodo}</div>
                <div class="history-row-concepto">${e.concepto}</div>
            </div>
            <div class="history-row-amount" style="color:var(--accent);">${fmt(e.monto)}</div>
        </div>
    `).join('');

    document.getElementById("providerModal").classList.add("open");
};

const closeModal = () => {
    document.getElementById("providerModal").classList.remove("open");
};

// Close modal on overlay click
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("providerModal").addEventListener("click", (e) => {
        if (e.target === document.getElementById("providerModal")) closeModal();
    });
});

// ── EXPORT CSV ──────────────────────────────────────────────────
const exportCSV = () => {
    const headers = ["Período", "Categoría", "Tipo", "Alerta", "Concepto", "Monto"];
    const rows = filteredExpenses.map(e => [
        e.periodo,
        e.rubro,
        e.tipo,
        e.anomalia ? `Anomalía +${e.desviacion_pct}%` : "Normal",
        `"${e.concepto.replace(/"/g, '""')}"`,
        e.monto.toFixed(2)
    ]);

    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sarmiento151_gastos_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// ── EXPORT PDF (IMPRESIÓN OPTIMIZADA) ───────────────────────────
const exportPDF = () => {
    const originalPageSize = pageSize;
    const originalCurrentPage = currentPage;

    // Forzar visualización de todos los registros en la tabla
    pageSize = 9999;
    currentPage = 1;
    renderTable();

    setTimeout(() => {
        window.print();
        
        // Restaurar la paginación de la UI
        pageSize = originalPageSize;
        currentPage = originalCurrentPage;
        renderTable();
    }, 250);
};

// ── FINES AND REGLAMENTO INTERNO CONTRAST RENDERER ─────────────
const getReglamentoFineAudit = (m) => {
    const mot = (m.motivo || "").toLowerCase();
    if (mot.includes("canilla") || mot.includes("filtracion")) {
        return `<span class="badge badge-danger" data-tooltip-right="Cap. 4 Reglamento Interno: Sólo tipifica como Falta Grave el daño intencional ('adrede'). Los descuidos accidentales sólo habilitan recuperar el gasto real con factura, no aplicar multas punitivas fijas.">🚫 No tipificada como multa (Cap. 4 RI)</span>`;
    }
    if (mot.includes("ruido") || mot.includes("reuni")) {
        return `<span class="badge badge-warning" data-tooltip-right="Art. 5 Reglamento Interno: Exige 3 o más quejas firmadas de distintos propietarios dirigidas a Administración y Consejo, y valuación igual a 1 expensa de depto. 2 ambientes.">⚠️ Exige 3 quejas firmadas + Valor 2 amb. (Art. 5 RI)</span>`;
    }
    if (mot.includes("perro") || mot.includes("mascota")) {
        return `<span class="badge badge-warning" data-tooltip-right="Art. 11 Reglamento Interno: Exige registro previo del Encargado en el Libro de Novedades, notificación al Consejo y valuación igual a 1 expensa de 2 ambientes.">⚠️ Exige Libro Novedades + Valor 2 amb. (Art. 11 RI)</span>`;
    }
    if (mot.includes("portón") || mot.includes("porton") || mot.includes("puerta")) {
        return `<span class="badge badge-warning" data-tooltip-right="Art. 1 Reglamento Interno: Fija como única unidad sancionatoria 'el último valor de una expensa de un departamento de dos ambientes', no un monto nominal arbitrario.">⚖️ Monto fijo vs. Expensa 2 amb. (Art. 1 RI)</span>`;
    }
    if (mot.includes("mudanza") || mot.includes("muebles")) {
        return `<span class="badge badge-warning" data-tooltip-right="Art. 2 Reglamento Interno: Fija horarios L-V 8-12/14-18 y Sáb 8-13 hs y multa equivalente al último valor de una expensa de 2 ambientes.">⚖️ Monto fijo vs. Expensa 2 amb. (Art. 2 RI)</span>`;
    }
    if (mot.includes("cochera") || mot.includes("estaciona") || mot.includes("vehículo") || mot.includes("auto")) {
        return `<span class="badge badge-warning" data-tooltip-right="Art. 3 Reglamento Interno: La multa debe equivaler exactamente al último valor de una expensa de un departamento de 2 ambientes.">⚖️ Monto fijo vs. Expensa 2 amb. (Art. 3 RI)</span>`;
    }
    if (mot.includes("basura") || mot.includes("residuo") || mot.includes("caja")) {
        return `<span class="badge badge-warning" data-tooltip-right="Art. 10 / Cap. 1 Reglamento Interno: Requiere denuncia escrita firmada con copia al Consejo y valuación reglamentaria de 1 expensa de 2 ambientes.">⚖️ Monto fijo vs. Expensa 2 amb. (RI)</span>`;
    }
    return `<span class="badge badge-danger" data-tooltip-right="Cap. 1 Reglamento Interno y Art. 2069 CCCN: Toda multa exige denuncia escrita firmada con copia al Consejo, identificación expresa de la causal e importe igual a 1 expensa de 2 ambientes.">🚫 Sin causal expresa ni art. (Cap. 1 RI)</span>`;
};

const renderFines = (period) => {
    const tbody = document.getElementById("finesTableBody");
    const subtitle = document.getElementById("finesSubtitle");

    if (period === "todos") {
        subtitle.textContent = "Mostrando las 58 multas acumuladas históricas contrastadas con el Reglamento Interno";
    } else {
        subtitle.textContent = `Multas aplicadas en la expensa de ${period} contrastadas con el Reglamento Interno`;
    }

    const filteredFines = period === "todos"
        ? [...rawMultas].sort((a, b) => b.periodo.localeCompare(a.periodo))
        : rawMultas.filter(m => m.periodo === period);

    if (filteredFines.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-3);padding:1.5rem;">No se registraron multas en este período.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredFines.map(m => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--text-2); white-space: nowrap;">UF ${m.uf}${period === "todos" ? ` <span style="font-size:0.7rem;color:var(--text-3);font-weight:400;">(${m.periodo})</span>` : ''}</td>
            <td style="padding: 0.75rem 0.5rem; color: var(--text-2); font-style: italic;">${m.motivo}</td>
            <td style="padding: 0.75rem 0.5rem;">${getReglamentoFineAudit(m)}</td>
            <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: #f43f5e; white-space: nowrap;">${fmt(m.monto)}</td>
        </tr>
    `).join('');
};

// ── PATRIMONIAL CHART RENDERER ─────────────────────────────────
const renderPatrimonialChart = () => {
    const cleanBalances = rawBalances
        .filter(b => b.patrimonio_neto > 0 && b.egresos > 0 && rawExpenses.filter(e => e.periodo === b.periodo).length >= 10)
        .sort((a, b) => a.periodo.localeCompare(b.periodo));

    const categories = cleanBalances.map(b => b.periodo);
    const patrimonio = cleanBalances.map(b => b.patrimonio_neto);
    const disponibilidades = cleanBalances.map(b => b.saldo_disponibilidades || b.saldo_banco);

    const totalPeriods = categories.length;
    const minIndex = Math.max(1, totalPeriods - 11);
    const maxIndex = totalPeriods;

    const opts = {
        series: [
            { name: 'Patrimonio Neto', data: patrimonio },
            { name: 'Disponibilidades Líquidas', data: disponibilidades }
        ],
        chart: {
            type: 'line',
            height: 280,
            foreColor: '#94a3b8',
            toolbar: {
                show: true,
                tools: {
                    download: false,
                    selection: false,
                    zoom: true,
                    zoomin: true,
                    zoomout: true,
                    pan: true,
                    reset: true
                }
            },
            zoom: {
                enabled: true,
                type: 'x',
                autoScaleYaxis: true
            },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors: ['#0ea5e9', '#10b981'],
        stroke: { curve: 'smooth', width: 3 },
        markers: { size: 4 },
        xaxis: {
            type: 'category',
            categories: categories,
            min: minIndex,
            max: maxIndex
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        tooltip: {
            theme: 'dark',
            y: { formatter: v => fmt(v) }
        }
    };

    if (chartPatrimonial) chartPatrimonial.destroy();
    chartPatrimonial = new ApexCharts(document.querySelector("#patrimonialChart"), opts);
    chartPatrimonial.render().then(() => {
        setTimeout(() => {
            if (chartPatrimonial) chartPatrimonial.zoomX(minIndex, maxIndex);
        }, 100);
    });
};

// ── PROVIDER AUDIT TABLE RENDERER ──────────────────────────────
const auditProviders = (period) => {
    const tbody = document.getElementById("providerAuditBody");
    if (!tbody) return;

    if (period === "todos") {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:1.5rem;">Seleccione un mes específico para auditar tarifas contra el año anterior.</td></tr>`;
        return;
    }

    const [y, m] = period.split("-").map(Number);
    const prevYearPeriod = `${y - 1}-${String(m).padStart(2, '0')}`;

    const targetProviders = [
        { name: "💼 Honorarios Administración", baseKey: "adm:honorarios_magarinos", rubro: "Honorarios Admin" },
        { name: "🛗 Guillemi (Ascensores)", baseKey: "abo:guillemi", rubro: "Abono Ascensores" },
        { name: "🚪 Lomas Lift (Portones)", baseKey: "abo:lomas_lift", rubro: "Abono Portones" },
        { name: "🏊 FB Saneamiento (Piscina)", baseKey: "abo:fb_saneamiento", rubro: "Abono Piscina" },
        { name: "🐜 Control de Plagas (Fumigación)", baseKey: "abo:fumigacion", rubro: "Abono Desinsectación" },
        { name: "⚡ Atila (Grupo Electrógeno)", baseKey: "abo:atila", rubro: "Mantenimiento GE" },
        { name: "💻 Sistema Global (Liquidación)", baseKey: "adm:sistema_global", rubro: "Software Gestión" },
        { name: "🌐 Telecentro (Internet SUM)", baseKey: "abo:telecentro_sum", rubro: "Servicio Conectividad" },
        { name: "🛡️ Allianz (Seguros)", baseKey: "seg:allianz", rubro: "Seguro Consorcio" }
    ];

    let rowsHtml = "";
    
    const ipcActual = ipcData[period]?.valor;
    const ipcPrev = ipcData[prevYearPeriod]?.valor;
    const ipcAcum = (ipcActual && ipcPrev) ? ((ipcActual - ipcPrev) / ipcPrev) * 100 : null;
    const ipcText = ipcAcum !== null ? `${ipcAcum.toFixed(1)}%` : "N/D";

    const findProviderAbono = (pTarget, baseKey) => {
        const matches = rawExpenses.filter(e =>
            e.periodo === pTarget &&
            e.estado !== "Pendiente" &&
            parseConceptMeta(e.concepto, e.rubro, e.periodo).baseKey === baseKey
        );
        if (matches.length === 0) return null;
        return matches.sort((a, b) => {
            const ma = parseConceptMeta(a.concepto, a.rubro, a.periodo).serviceMonth || "";
            const mb = parseConceptMeta(b.concepto, b.rubro, b.periodo).serviceMonth || "";
            if (ma !== mb) return mb.localeCompare(ma);
            return b.monto - a.monto;
        })[0];
    };

    targetProviders.forEach(p => {
        const actualExpense = findProviderAbono(period, p.baseKey);
        const prevExpense = findProviderAbono(prevYearPeriod, p.baseKey);

        if (actualExpense && prevExpense) {
            const varPct = ((actualExpense.monto - prevExpense.monto) / prevExpense.monto) * 100;
            
            let badge = `<span class="badge badge-success">🟢 Estable</span>`;
            if (ipcAcum !== null) {
                if (varPct > ipcAcum + 25) {
                    badge = `<span class="badge badge-danger">🔴 Excesivo (> IPC + 25%)</span>`;
                } else if (varPct > ipcAcum + 5) {
                    badge = `<span class="badge badge-warning">🟡 Alto (> IPC)</span>`;
                }
            }

            let diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3); font-size: 0.85rem;">N/D</td>`;
            if (ipcAcum !== null) {
                const expected = prevExpense.monto * (1 + (ipcAcum / 100));
                const diffValue = actualExpense.monto - expected;
                const diffFmt = fmt(Math.abs(diffValue));
                if (diffValue > 50) {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: #f43f5e; font-weight: 700; font-size: 0.85rem;">+${diffFmt}</td>`;
                } else if (diffValue < -50) {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: #10b981; font-weight: 700; font-size: 0.85rem;">-${diffFmt}</td>`;
                } else {
                    diffHtml = `<td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3); font-size: 0.85rem;">$0</td>`;
                }
            }

            rowsHtml += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 0.75rem 0.5rem; text-align: left; font-weight: 600; color: var(--text-2);">${p.name}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: left; color: var(--text-3); font-size: 0.8rem;">${p.rubro}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: var(--text-1);">${fmt(actualExpense.monto)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3);">${fmt(prevExpense.monto)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 700; color: ${ipcAcum !== null && varPct > ipcAcum ? '#f43f5e' : '#10b981'};">${varPct.toFixed(1)}%</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-2); font-weight: 500;">${ipcText}</td>
                    ${diffHtml}
                    <td style="padding: 0.75rem 0.5rem; text-align: center; vertical-align: middle;">${badge}</td>
                </tr>
            `;
        }
    });

    if (rowsHtml === "") {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:1.5rem;">No se encontraron facturas comparativas de abonos fijos para este período.</td></tr>`;
    } else {
        tbody.innerHTML = rowsHtml;
    }
};

// ── SERVICES STATUS MONITOR RENDERER ───────────────────────────
const loadServicesStatus = () => {
    const container = document.getElementById("servicesStatusWidget");
    if (!container) return;

    fetch(new URL("servicios_status.json", document.baseURI).href)
        .then(r => r.json())
        .then(data => {
            const edesur = data.edesur || { status: "Normal", message: "Sin alertas" };
            const aysa = data.aysa || { status: "Normal", message: "Sin alertas" };
            const metrogas = data.metrogas || { status: "Normal", message: "Sin alertas" };

            const getBadge = (srv) => {
                if (srv.status === "Alerta") {
                    return `<span class="badge badge-warning" style="white-space: nowrap;">⚠️ Alerta</span>`;
                }
                return `<span class="badge badge-success" style="white-space: nowrap;">🟢 Normal</span>`;
            };

            const getMessageHtml = (srv) => {
                if (srv.status === "Alerta" && srv.message) {
                    return `<div style="font-size: 0.65rem; color: var(--text-3); margin-top: 1px; margin-bottom: 0.4rem; padding-left: 12px; border-left: 1.5px dashed rgba(251,191,36,0.4); line-height: 1.25;">${srv.message}</div>`;
                }
                return '';
            };

            container.innerHTML = `
                <!-- EDESUR -->
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">⚡ Luz (Edesur)</span>
                        ${getBadge(edesur)}
                    </div>
                    ${getMessageHtml(edesur)}
                </div>

                <!-- AYSA -->
                <div style="margin-bottom: 0.35rem; cursor: pointer;" onclick="if(typeof openAysaModal === 'function') openAysaModal();" title="Click para ver detalle del corte programado">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">💧 Agua (AySA)</span>
                        ${getBadge(aysa)}
                    </div>
                    ${getMessageHtml(aysa)}
                </div>

                <!-- METROGAS -->
                <div style="margin-bottom: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                        <span style="color: var(--text-2);">🔥 Gas (Metrogas)</span>
                        ${getBadge(metrogas)}
                    </div>
                    ${getMessageHtml(metrogas)}
                </div>

                <div style="font-size: 0.6rem; color: var(--text-3); text-align: right; margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 4px; cursor: help; border-bottom: 1px dotted rgba(255,255,255,0.1); width: max-content; margin-left: auto;" data-tooltip-top-right="El estado se actualiza automáticamente 4 veces al día (06:00, 12:00, 18:00 y 21:00 hs) consultando los servidores oficiales de las prestadoras.">Act: ${data.actualizado || 'N/D'}</div>
            `;
        })
        .catch(err => {
            console.warn("No se pudo cargar el estado de servicios:", err);
            container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-3);">Estado no disponible</span>`;
        });
};


