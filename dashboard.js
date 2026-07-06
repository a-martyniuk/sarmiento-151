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

        // Proyectar meses futuros hasta 2026-07 para evitar N/D
        const periods = Object.keys(ipcData).sort();
        if (periods.length > 0) {
            let lastPeriod = periods[periods.length - 1];
            let lastVal = ipcData[lastPeriod].valor;
            let [y, m] = lastPeriod.split("-").map(Number);
            const limitYear = 2026;
            const limitMonth = 7;

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

// ── Match concepts intelligently ───────────────────────────────
const matchConcept = (c1, c2) => {
    const raw1 = c1.toLowerCase();
    const raw2 = c2.toLowerCase();
    
    // Si tienen números de cuenta de AySA (1411XX) diferentes, no deben emparejarse
    const getAySA = (s) => { const m = s.match(/1411\d+/); return m ? m[0] : null; };
    const a1 = getAySA(raw1), a2 = getAySA(raw2);
    if (a1 && a2 && a1 !== a2) return false;

    // Si tienen números de cliente de Edesur (8050XX) diferentes, no deben emparejarse
    const getEdesur = (s) => { const m = s.match(/8050\d+/); return m ? m[0] : null; };
    const e1 = getEdesur(raw1), e2 = getEdesur(raw2);
    if (e1 && e2 && e1 !== e2) return false;

    // Comparación de prefijo mayor (30 caracteres)
    return raw1.slice(0, 30) === raw2.slice(0, 30);
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
                const periods = [...new Set(allExpenses.map(e => e.periodo))].sort();
                const latestPeriod = periods[periods.length - 1];
                // Excluir globalmente el último período en curso por ser preliminar
                rawExpenses = allExpenses.filter(e => e.periodo !== latestPeriod);
                rawBalances = allBalances.filter(e => e.periodo !== latestPeriod);
                rawMultas   = allMultas.filter(e => e.periodo !== latestPeriod);
            } else {
                rawExpenses = [];
                rawBalances = [];
                rawMultas   = [];
            }

            // Corregir anomalías históricas usando media móvil para evitar distorsiones por inflación acumulada
            rawExpenses.sort((a, b) => a.periodo.localeCompare(b.periodo));
            const history = {};
            rawExpenses.forEach(e => {
                const key = e.concepto.toLowerCase().slice(0, 30);
                const prev = history[key] || [];
                const isSAC = e.concepto.toUpperCase().includes("SAC");
                if (prev.length >= 2) {
                    const recent = prev.slice(-3);
                    const avg = recent.reduce((a, v) => a + v, 0) / recent.length;
                    if (avg > 10000 && e.monto > (avg * 1.45) && !isSAC) {
                        e.anomalia = true;
                        e.desviacion_pct = Math.round(((e.monto - avg) / avg) * 100);
                    } else {
                        e.anomalia = false;
                        e.desviacion_pct = 0;
                    }
                } else {
                    e.anomalia = false;
                    e.desviacion_pct = 0;
                }
                if (!history[key]) history[key] = [];
                history[key].push(e.monto);
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

    // Seleccionar por defecto el período consolidado más reciente en lugar de "todos"
    if (periods.length > 0) {
        sel.value = periods[0];
    }

    // Update sidebar badge
    document.getElementById("sidebarPeriods").textContent = `${periods.length} meses consolidados`;
};

// ── Apply filter ────────────────────────────────────────────────
const applyFilter = () => {
    const periodSel  = document.getElementById("periodFilter");
    const searchInp  = document.getElementById("searchInput");
    const statusSel  = document.getElementById("statusFilter");

    const period = periodSel.value;
    const query  = searchInp.value.toLowerCase().trim();
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
    searchInp.addEventListener("input",  applyFilter);
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
        recurrents.forEach(rec => {
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

    section.style.display = "block";
    container.innerHTML = anomalies.map(item => `
        <div class="anomaly-item">
            <div class="anomaly-item-header">
                <span class="anomaly-badge" data-tooltip="Este gasto supera al promedio móvil histórico de las últimas 3 facturas de este mismo concepto." style="cursor: help;">+${item.desviacion_pct}% del histórico</span>
                <span class="anomaly-monto">${fmt(item.monto)}</span>
            </div>
            <div class="anomaly-concepto">${item.concepto}</div>
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
    const minIndex = Math.max(0, totalPeriods - 12);
    const maxIndex = totalPeriods - 1;

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
        legend: { position: 'top', labels: { colors: '#94a3b8' } },
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
    chartHistorical.render();
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
    const allPeriods = [...new Set(cleanExpenses.map(e => e.periodo))].sort().slice(-12);
    const cats = Object.keys(CAT_CONFIG);
    const colors = cats.map(c => CAT_CONFIG[c].dot);

    const series = cats.map(cat => ({
        name: cat,
        data: allPeriods.map(p =>
            Math.round(cleanExpenses.filter(e => e.periodo === p && e.rubro === cat)
                .reduce((a, e) => a + e.monto, 0))
        )
    }));

    const opts = {
        series,
        chart: { type: 'bar', height: 320, stacked: true, foreColor: '#94a3b8', toolbar: { show: false }, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        colors,
        plotOptions: { bar: { horizontal: false, columnWidth: '60%', borderRadius: 3 } },
        xaxis: {
            categories: allPeriods,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        fill: { opacity: 0.9 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartComparison) chartComparison.destroy();
    chartComparison = new ApexCharts(document.querySelector("#comparisonChart"), opts);
    chartComparison.render();
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
    const allPeriods = [...new Set(cleanExpenses.map(e => e.periodo))].sort().slice(-12);
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

    const opts = {
        series,
        chart: { type: 'bar', height: 260, stacked: true, foreColor: '#94a3b8', toolbar: { show: false }, background: 'transparent', fontFamily: 'Inter, sans-serif' },
        colors,
        plotOptions: { bar: { horizontal: false, columnWidth: '65%', borderRadius: 2 } },
        xaxis: {
            categories: allPeriods,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -40, style: { fontSize: '9px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`
            }
        },
        grid: { borderColor: 'rgba(255,255,255,0.03)' },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '10px', height: 45 },
        fill: { opacity: 0.95 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (currentInstance) currentInstance.destroy();
    const chart = new ApexCharts(document.querySelector(selectorId), opts);
    chart.render();
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
const renderEmployeeChart = () => {
    const periods = [...new Set(rawExpenses.map(e => e.periodo))].sort().slice(-16);

    const sumBy = (nombre) => periods.map(p =>
        Math.round(rawExpenses
            .filter(e => e.periodo === p && e.empleado === nombre)
            .reduce((a, e) => a + e.monto, 0))
    );

    const series = [
        { name: 'Ibrahim Yamil',           data: sumBy('Ibrahim Yamil') },
        { name: 'Lourdes Zaracho',         data: sumBy('Lourdes Zaracho') },
        { name: 'Cargas Sociales / ART',   data: sumBy('Cargas Sociales / Sindicato') },
        { name: 'Yamil Reparaciones',      data: sumBy('Yamil Reparaciones') },
    ];

    const opts = {
        series,
        chart: {
            type: 'bar', height: 300, stacked: false,
            foreColor: '#94a3b8', toolbar: { show: false },
            background: 'transparent', fontFamily: 'Inter, sans-serif'
        },
        colors: ['#06b6d4', '#f472b6', '#fbbf24', '#a78bfa'],
        plotOptions: { bar: { horizontal: false, columnWidth: '65%', borderRadius: 3 } },
        xaxis: {
            categories: periods,
            axisBorder: { show: false }, axisTicks: { show: false },
            labels: { rotate: -30, style: { fontSize: '10px' } }
        },
        yaxis: {
            labels: {
                formatter: v => v >= 1000000 ? '$' + (v/1000000).toFixed(1) + 'M'
                             : v >= 1000 ? '$' + Math.round(v/1000) + 'k' : '$' + v
            }
        },
        grid: { borderColor: 'rgba(255,255,255,0.05)' },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px' },
        fill: { opacity: 0.9 },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: v => fmtFull(v) } }
    };

    if (chartEmployee) chartEmployee.destroy();
    chartEmployee = new ApexCharts(document.querySelector('#employeeChart'), opts);
    chartEmployee.render();
};

// ── EMPLOYEE KPI CARDS ───────────────────────────────────────────
const renderEmployeeKPIs = (period) => {
    const sumEmp = (nombre) => {
        const src = period === 'todos'
            ? rawExpenses.filter(e => e.empleado === nombre)
            : rawExpenses.filter(e => e.periodo === period && e.empleado === nombre);
        return src.reduce((a, e) => a + e.monto, 0);
    };

    const ibTotal  = sumEmp('Ibrahim Yamil');
    const loTotal  = sumEmp('Lourdes Zaracho');
    const crTotal  = sumEmp('Cargas Sociales / Sindicato');
    const yrTotal  = sumEmp('Yamil Reparaciones');

    const ibHist = rawExpenses.filter(e => e.empleado === 'Ibrahim Yamil').reduce((a,e) => a+e.monto, 0);
    const loHist = rawExpenses.filter(e => e.empleado === 'Lourdes Zaracho').reduce((a,e) => a+e.monto, 0);

    document.getElementById('empIbrahimMonto').textContent  = ibTotal > 0 ? fmt(ibTotal) : '—';
    document.getElementById('empLourdesMonto').textContent  = loTotal > 0 ? fmt(loTotal) : '—';
    document.getElementById('empCargasMonto').textContent   = crTotal > 0 ? fmt(crTotal)  : '—';
    document.getElementById('empYamilRepMonto').textContent = yrTotal > 0 ? fmt(yrTotal)  : '—';
    document.getElementById('empIbrahimHist').textContent   = 'Acum. histórico: ' + fmt(ibHist);
    document.getElementById('empLourdesHist').textContent   = 'Acum. histórico: ' + fmt(loHist);
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
        const isSAC = item.concepto.toLowerCase().includes("sac") || item.concepto.toLowerCase().includes("aguinaldo");
        const pp = prevPeriod(item.periodo);

        const prevItem = isSAC ? null : rawExpenses.find(x =>
            x.periodo === pp &&
            matchConcept(x.concepto, item.concepto)
        );

        let prevMonto = 0, varHtml = `<span class="var-null">—</span>`, diff = 0;
        if (prevItem) {
            prevMonto = prevItem.monto;
            diff = ((item.monto - prevMonto) / prevMonto) * 100;
            if (diff > 0.5)       varHtml = `<span class="var-up">+${diff.toFixed(1)}% ▲</span>`;
            else if (diff < -0.5) varHtml = `<span class="var-down">${diff.toFixed(1)}% ▼</span>`;
            else                  varHtml = `<span class="var-null">≈ 0%</span>`;
        }

        const tipoBadge     = item.tipo === "Fijo"
            ? `<span class="badge badge-fijo">Fijo</span>`
            : `<span class="badge badge-variable">Variable</span>`;

        let badges = [];
        if (item.anomalia) {
            badges.push(`<span class="badge badge-anomalia" title="Desviación +${item.desviacion_pct}% del histórico">⚠ Anomalía</span>`);
        }
        
        // Aplica a fijos, abonos o servicios recurrentes (como Telecentro, luz, agua, etc.) que suban >25%
        const esRecurrente = item.tipo === "Fijo" || ["servicios públicos", "contratos y abonos", "varios"].includes(item.rubro.toLowerCase());
        if (esRecurrente && diff > 25) {
            badges.push(`<span class="badge badge-anomalia" style="background:rgba(251,146,60,0.1); border-color:#fb923c; color:#fb923c;" title="Aumento mayor al 25% respecto al mes anterior">⚠️ Aumento >25%</span>`);
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
                <span class="concepto-text" onclick="openModal('${conceptSafe}')">${item.concepto}</span>
            </td>
            <td class="amount-col amount-prev">${prevMonto > 0 ? fmt(prevMonto) : '—'}</td>
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

// ── MODAL PROVEEDOR ─────────────────────────────────────────────
const openModal = (conceptoRaw) => {
    const concepto = conceptoRaw.replace(/\\'/g, "'").replace(/&quot;/g, '"');
    const provExpenses = rawExpenses
        .filter(e => matchConcept(e.concepto, concepto))
        .sort((a, b) => b.periodo.localeCompare(a.periodo));

    if (provExpenses.length === 0) return;

    const total   = provExpenses.reduce((a, e) => a + e.monto, 0);
    const totalObras = rawExpenses.filter(e => e.rubro === "Obras y Reparaciones")
        .reduce((a, e) => a + e.monto, 0) || 1;
    const obrasMonto = provExpenses.filter(e => e.rubro === "Obras y Reparaciones")
        .reduce((a, e) => a + e.monto, 0);
    const porcentaje  = (obrasMonto / totalObras) * 100;
    const avg = total / provExpenses.length;

    document.getElementById("providerModalName").textContent = concepto.slice(0, 60) + (concepto.length > 60 ? '…' : '');
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

// ── FINES AND APPORTIONMENTS RENDERERS ─────────────────────────
const renderFines = (period) => {
    const tbody = document.getElementById("finesTableBody");
    const subtitle = document.getElementById("finesSubtitle");

    if (period === "todos") {
        subtitle.textContent = "Mostrando multas acumuladas históricas";
    } else {
        subtitle.textContent = `Multas aplicadas en la expensa de ${period}`;
    }

    const filteredFines = period === "todos"
        ? rawMultas
        : rawMultas.filter(m => m.periodo === period);

    if (filteredFines.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:1.5rem;">No se registraron multas en este período.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredFines.map(m => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 0.75rem 0.5rem; font-weight: 500; color: var(--text-2);">${m.uf}</td>
            <td style="padding: 0.75rem 0.5rem; color: var(--text-3); font-style: italic;">${m.motivo}</td>
            <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 600; color: #f43f5e;">${fmt(m.monto)}</td>
        </tr>
    `).join('');
};

// ── PATRIMONIAL CHART RENDERER ─────────────────────────────────
const renderPatrimonialChart = () => {
    const cleanBalances = rawBalances
        .filter(b => b.periodo !== "2026-07" && b.patrimonio_neto > 0)
        .sort((a, b) => a.periodo.localeCompare(b.periodo));

    const categories = cleanBalances.map(b => b.periodo);
    const patrimonio = cleanBalances.map(b => b.patrimonio_neto);
    const disponibilidades = cleanBalances.map(b => b.saldo_disponibilidades || b.saldo_banco);

    const opts = {
        series: [
            { name: 'Patrimonio Neto', data: patrimonio },
            { name: 'Disponibilidades Líquidas', data: disponibilidades }
        ],
        chart: {
            type: 'line',
            height: 280,
            foreColor: '#94a3b8',
            toolbar: { show: false },
            background: 'transparent',
            fontFamily: 'Inter, sans-serif'
        },
        colors: ['#0ea5e9', '#10b981'],
        stroke: { curve: 'smooth', width: 3 },
        markers: { size: 4 },
        xaxis: { categories: categories },
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
    chartPatrimonial.render();
};

// ── PROVIDER AUDIT TABLE RENDERER ──────────────────────────────
const auditProviders = (period) => {
    const tbody = document.getElementById("providerAuditBody");
    if (!tbody) return;

    if (period === "todos") {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:1.5rem;">Seleccione un mes específico para auditar tarifas contra el año anterior.</td></tr>`;
        return;
    }

    const [y, m] = period.split("-").map(Number);
    const prevPeriod = `${y - 1}-${String(m).padStart(2, '0')}`;

    // Proveedores y sus palabras clave
    const targetProviders = [
        { name: "Guillemi (Ascensores)", key: "guillemi", rubro: "Abono Ascensores" },
        { name: "FB Saneamiento (Piscina)", key: "saneamiento", rubro: "Abono Piscina" },
        { name: "Atila (Grupo Electrógeno)", key: "atila", rubro: "Mantenimiento GE" },
        { name: "Telecentro (Internet)", key: "telecentro", rubro: "Servicio Conectividad" },
        { name: "Allianz (Seguros)", key: "allianz", rubro: "Seguro Consorcio" }
    ];

    let rowsHtml = "";
    
    // Obtener inflación acumulada oficial INDEC
    const ipcActual = ipcData[period]?.valor;
    const ipcPrev = ipcData[prevPeriod]?.valor;
    const ipcAcum = (ipcActual && ipcPrev) ? ((ipcActual - ipcPrev) / ipcPrev) * 100 : null;
    const ipcText = ipcAcum !== null ? `${ipcAcum.toFixed(1)}%` : "N/D";

    targetProviders.forEach(p => {
        // Buscar el gasto del mes actual
        const actualExpense = rawExpenses.find(e => e.periodo === period && e.concepto.toLowerCase().includes(p.key));
        // Buscar el gasto del año anterior
        const prevExpense = rawExpenses.find(e => e.periodo === prevPeriod && e.concepto.toLowerCase().includes(p.key));

        if (actualExpense && prevExpense) {
            const varPct = ((actualExpense.monto - prevExpense.monto) / prevExpense.monto) * 100;
            
            let badge = `<span class="badge badge-success">Estable</span>`;
            if (ipcAcum !== null) {
                if (varPct > ipcAcum + 25) {
                    badge = `<span class="badge badge-danger">Alerta Excesivo (> IPC + 25%)</span>`;
                } else if (varPct > ipcAcum + 5) {
                    badge = `<span class="badge badge-warning">Aumento Alto (> IPC)</span>`;
                }
            }

            rowsHtml += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 0.75rem 0.5rem; text-align: left; font-weight: 500; color: var(--text-2);">${p.name}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: left; color: var(--text-3); font-size: 0.8rem;">${p.rubro}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 600; color: var(--text-1);">${fmt(actualExpense.monto)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-3);">${fmt(prevExpense.monto)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; font-weight: 600; color: ${varPct > 0 ? '#f43f5e' : '#10b981'};">${varPct.toFixed(1)}%</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-2); font-weight: 500;">${ipcText}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: center;">${badge}</td>
                </tr>
            `;
        }
    });

    if (rowsHtml === "") {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-3);padding:1.5rem;">No se encontraron facturas comparativas de abonos fijos para este período.</td></tr>`;
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
                <div style="margin-bottom: 0.35rem;">
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

                <div style="font-size: 0.6rem; color: var(--text-3); text-align: right; margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 4px;">Act: ${data.actualizado || 'N/D'}</div>
            `;
        })
        .catch(err => {
            console.warn("No se pudo cargar el estado de servicios:", err);
            container.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-3);">Estado no disponible</span>`;
        });
};


