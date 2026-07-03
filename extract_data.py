import os
import re
import json
import pdfplumber

LIQUIDACIONES_DIR = "liquidaciones"
OUTPUT_JSON = "gastos.json"

CATEGORIAS_REALES = [
    "Sueldos y Cargas Sociales",
    "Seguros",
    "Servicios Públicos",
    "Contratos y Abonos",
    "Administración",
    "Mantenimiento y Reparaciones",
    "Varios",
]

def get_categoria_amigable(rubro, concepto):
    r = rubro.lower()
    c = concepto.lower()

    for cat in CATEGORIAS_REALES:
        if cat.lower() in r:
            return cat

    if any(x in r for x in ["sueldo", "carga", "personal", "portería", "porteria"]) or \
       any(x in c for x in ["sueldo", "suterh", "seracarh", "fateryh", "jubilaci",
                             "encargad", "porter", "s.u.t.e.r.h", "sindicato",
                             "art ", "zaracho", "ibrahim", "yamil"]):
        return "Sueldos y Cargas Sociales"

    if any(x in r for x in ["seguro"]) or \
       any(x in c for x in ["seguro", "poliza", "póliza", "sancor", "mapfre",
                             "swiss", "allianz", "incendio", "responsabilidad civil"]):
        return "Seguros"

    if any(x in r for x in ["servicio", "public"]) or \
       any(x in c for x in ["aysa", "edesur", "metrogas", "telecom", "claro",
                             "telefon", "aguas", "agua y cloaca"]):
        return "Servicios Públicos"

    if any(x in r for x in ["contrato", "abono"]) or \
       any(x in c for x in ["abono", "contrato", "fumigaci", "plagas", "ascensor",
                             "matafuego", "conservaci", "limpieza de tanques",
                             "porton", "piscina", "pileta", "saneamiento"]):
        if not any(x in c for x in ["reparaci", "reconstruc"]):
            return "Contratos y Abonos"

    if any(x in r for x in ["administr", "honorario", "gestion", "gestión"]) or \
       any(x in c for x in ["honorario", "administr", "banco", "impuesto",
                             "comision", "comisión", "sistema", "gasto bancario",
                             "afip", "tasa", "sellado", "correo", "franqueo"]):
        return "Administración"

    if any(x in r for x in ["mantenimiento", "reparaci", "obra"]) or \
       any(x in c for x in ["reparaci", "instalaci", "pintura", "herrer", "plomer",
                             "bomba", "materiales", "reconstruc", "albañil",
                             "sanitario", "electricidad", "cerrajería", "cerraje",
                             "portones", "vidrier", "gasista"]):
        return "Mantenimiento y Reparaciones"

    return "Varios"

def clean_concept_text(concept):
    text = concept
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def clean_amount(val_str):
    if not val_str:
        return 0.0
    val_str = val_str.replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return float(val_str)
    except ValueError:
        return 0.0

def parse_pdf_expenses(filepath):
    expenses = []
    multas = []
    
    filename = os.path.basename(filepath)
    match_date = re.search(r"(\d{4})-(\d{2})", filename)
    if not match_date:
        return [], None, []
    
    period = f"{match_date.group(1)}-{match_date.group(2)}"
    current_rubro = "Gastos Varios"

    balance_data = {
        "periodo": period,
        "ingresos": 0.0,
        "egresos": 0.0,
        "saldo_banco": 0.0,
        "recaudado_termino": 0.0,
        "deuda_acumulada": 0.0,
        "patrimonio_neto": 0.0,
        "saldo_disponibilidades": 0.0
    }

    seccion_gasto = "Pagado"

    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue

            lines = text.split("\n")
            current_expense = None
            in_rubro = False
            in_multas = False

            for line in lines:
                line = line.strip()

                # Detectar bloque de multas en la liquidación
                if "Detalle de Multas" in line or "Detalle de multas" in line:
                    in_multas = True
                    if current_expense:
                        expenses.append(current_expense)
                        current_expense = None
                    in_rubro = False
                    continue

                if in_multas:
                    if any(x in line for x in ["NOTAS", "Ante cualquier", "Administración:", "Consorcio:", "Período:"]):
                        in_multas = False
                        continue
                    
                    # Regex para multas: UF, propietario + motivo, importe
                    m_multa = re.match(r'^(\d+)\s+(.+?)\s+(\d+)\s*$', line)
                    if m_multa:
                        uf = m_multa.group(1)
                        prop_motivo = m_multa.group(2)
                        monto_multa = float(m_multa.group(3))
                        
                        partes = re.split(r'\s+[Pp]or\s+', prop_motivo, 1)
                        if len(partes) == 2:
                            prop = partes[0].strip()
                            motivo = "Por " + partes[1].strip()
                        else:
                            prop = prop_motivo
                            motivo = "Multa aplicada"
                            
                        multas.append({
                            "periodo": period,
                            "uf": uf,
                            "propietario": prop,
                            "motivo": motivo,
                            "monto": monto_multa
                        })
                    continue

                # Detectar cambio de sección en la liquidación
                if "GASTOS DEVENGADOS PENDIENTES DE PAGO" in line:
                    seccion_gasto = "Pendiente"
                elif "PAGOS DEL PER" in line or "PAGOS DEL PERIODO" in line:
                    seccion_gasto = "Pagado"

                # Extraer ingresos y saldos de caja del resumen final
                if "Ingresos" in line and not "adeudadas" in line and not "título" in line:
                    match_ing = re.search(r'Ingresos\s+([\d.,\s-]+)', line)
                    if match_ing:
                        balance_data["ingresos"] = max(balance_data["ingresos"], clean_amount(match_ing.group(1)))
                if "Egresos" in line and not "vicios" in line:
                    match_egr = re.search(r'Egresos\s+([\d.,\s-]+)', line)
                    if match_egr:
                        balance_data["egresos"] = max(balance_data["egresos"], clean_amount(match_egr.group(1)))
                if "SALDO FINAL" in line:
                    match_sld = re.search(r'SALDO FINAL\s+([\d.,\s-]+)', line)
                    if match_sld:
                        balance_data["saldo_banco"] = max(balance_data["saldo_banco"], clean_amount(match_sld.group(1)))
                
                # Extraer ingresos por pago en término y deuda acumulada
                if "trmino" in line.lower() or "t\u00e9rmino" in line.lower() or "t\u00e3\u00a9rmino" in line.lower() or "t\u00e3\u00a1rmino" in line.lower() or "en t" in line.lower():
                    match_trm = re.search(r'([\d.,\s-]+)$', line)
                    if match_trm:
                        balance_data["recaudado_termino"] = clean_amount(match_trm.group(1))
                if "Expensas y otros activos a cobrar" in line or "activos a cobrar" in line or "cobrar" in line:
                    match_act = re.search(r'cobrar\s+([\d.,\s-]+)', line)
                    if match_act:
                        balance_data["deuda_acumulada"] = clean_amount(match_act.group(1))

                # Extraer Patrimonio Neto y Disponibilidades al Cierre
                if "SALDO DE DISPONIBILIDADES" in line or "DISPONIBILIDADES AL CIERRE" in line:
                    line_clean = re.sub(r'\d{2}/\d{2}/\d{4}:?', '', line)
                    match_disp = re.search(r'([\d.,\s-]+)$', line_clean)
                    if match_disp:
                        balance_data["saldo_disponibilidades"] = clean_amount(match_disp.group(1))

                if "PATRIMONIO NETO" in line:
                    line_clean = re.sub(r'\d{2}/\d{2}/\d{4}:?', '', line)
                    match_pn = re.search(r'([\d.,\s-]+)$', line_clean)
                    if match_pn:
                        balance_data["patrimonio_neto"] = clean_amount(match_pn.group(1))

                # Detectar encabezado de rubro
                match_rubro_start = re.match(
                    r"^(\d+)\s+([A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s\/Y]+?)\s+(Grupo|CONCEPTO|Total|SIN LOCALES)",
                    line
                )
                if match_rubro_start:
                    if current_expense:
                        expenses.append(current_expense)
                        current_expense = None

                    nombre_rubro_raw = match_rubro_start.group(2).strip()
                    nombre_upper = nombre_rubro_raw.upper()
                    if "SUELDO" in nombre_upper or "CARGAS" in nombre_upper or "PERSONAL" in nombre_upper:
                        current_rubro = "Sueldos y Cargas Sociales"
                    elif "SEGURO" in nombre_upper:
                        current_rubro = "Seguros"
                    elif "SERVICIO" in nombre_upper or "P\u00daBLICO" in nombre_upper or "PUBLICO" in nombre_upper:
                        current_rubro = "Servicios Públicos"
                    elif "CONTRATO" in nombre_upper or "ABONO" in nombre_upper:
                        current_rubro = "Contratos y Abonos"
                    elif "ADMINISTR" in nombre_upper:
                        current_rubro = "Administración"
                    elif "MANTENIMIENTO" in nombre_upper or "REPARACI" in nombre_upper:
                        current_rubro = "Mantenimiento y Reparaciones"
                    elif "VARIOS" in nombre_upper:
                        current_rubro = "Varios"
                    else:
                        current_rubro = nombre_rubro_raw.title()
                    
                    in_rubro = True
                    continue

                if not in_rubro:
                    continue

                if "TOTAL RUBRO" in line or line.startswith("TOTAL ") or "Saldo anterior" in line or "Ingresos por pago" in line:
                    if current_expense:
                        expenses.append(current_expense)
                        current_expense = None
                    in_rubro = False
                    continue

                # ── Extraer gasto de la línea ──────────────────────────────────────
                m_exp = re.search(r'^(.*?)\s+((?:-?\d+(?:\.\d{3})*,\d{2}\s+)*-?\d+(?:\.\d{3})*,\d{2})$', line)
                if m_exp:
                    if current_expense:
                        expenses.append(current_expense)
                        current_expense = None

                    concept_part = m_exp.group(1).strip()
                    amounts_part = m_exp.group(2).strip()
                    amounts_list = re.split(r'\s+', amounts_part)
                    total_str = amounts_list[-1]
                    total_amount = clean_amount(total_str)

                    if len(concept_part) < 4:
                        continue
                    if total_amount <= 0:
                        continue
                    concept_lower = concept_part.lower()
                    if any(x in concept_lower for x in [
                        "saldo final", "saldo inicial", "bancarios",
                        "estado patrimonial", "patrimonio neto",
                        "disponibilidades", "movimientos", "concepto",
                        "grupo a", "sin locales", "exp.ext", "multa",
                        "egresos", "ingresos", "saldo al", "saldo de", "resumen de"
                    ]):
                        continue
                    if re.match(r'^[\d.,\s%-]+$', concept_part):
                        continue

                    clean_concept = clean_concept_text(concept_part)
                    categoria = get_categoria_amigable(current_rubro, clean_concept)

                    c_lower = clean_concept.lower()
                    servicio_publico = None
                    if "aysa" in c_lower or ("agua" in c_lower and "cloaca" in c_lower):
                        servicio_publico = "AySA"
                    elif "edesur" in c_lower or "luz" in c_lower or "energ" in c_lower:
                        servicio_publico = "Edesur"
                    elif "metrogas" in c_lower:
                        servicio_publico = "Metrogas"

                    empleado = None
                    if "ibrahim yamil" in c_lower and "yamil reparaciones" not in c_lower:
                        empleado = "Ibrahim Yamil"
                    elif "lourdes zaracho" in c_lower or "zaracho" in c_lower:
                        empleado = "Lourdes Zaracho"
                    elif "yamil reparaciones" in c_lower:
                        empleado = "Yamil Reparaciones"
                    elif any(x in c_lower for x in ["cargas sociales", "art ", "seracarh",
                                                     "suterh", "fateryh", "jubilaci", "aporte"]):
                        empleado = "Cargas Sociales / Sindicato"

                    tipo = "Fijo" if categoria in [
                        "Sueldos y Cargas Sociales",
                        "Servicios Públicos",
                        "Contratos y Abonos",
                        "Administración",
                        "Seguros"
                    ] else "Variable"

                    current_expense = {
                        "periodo":  period,
                        "rubro":    categoria,
                        "concepto": clean_concept,
                        "monto":    total_amount,
                        "tipo":     tipo,
                        "servicio": servicio_publico,
                        "empleado": empleado,
                        "estado":   seccion_gasto
                    }
                else:
                    if current_expense and len(line) > 2:
                        if not any(x in line for x in ["Grupo A", "SIN LOCALES", "EXP.EXT", "MULTA", "Total"]):
                            cleaned_part = clean_concept_text(line)
                            current_expense["concepto"] += " " + cleaned_part
                            
                            c_updated = current_expense["concepto"].lower()
                            current_expense["rubro"] = get_categoria_amigable(current_rubro, current_expense["concepto"])
                            
                            if "aysa" in c_updated or ("agua" in c_updated and "cloaca" in c_updated):
                                current_expense["servicio"] = "AySA"
                            elif "edesur" in c_updated or "luz" in c_updated or "energ" in c_updated:
                                current_expense["servicio"] = "Edesur"
                            elif "metrogas" in c_updated:
                                current_expense["servicio"] = "Metrogas"

                            if "ibrahim yamil" in c_updated and "yamil reparaciones" not in c_updated:
                                current_expense["empleado"] = "Ibrahim Yamil"
                            elif "lourdes zaracho" in c_updated or "zaracho" in c_updated:
                                current_expense["empleado"] = "Lourdes Zaracho"
                            elif "yamil reparaciones" in c_updated:
                                current_expense["empleado"] = "Yamil Reparaciones"
                            elif any(x in c_updated for x in ["cargas sociales", "art ", "seracarh",
                                                             "suterh", "fateryh", "jubilaci", "aporte"]):
                                current_expense["empleado"] = "Cargas Sociales / Sindicato"

            if current_expense:
                expenses.append(current_expense)
                current_expense = None

    # Eliminar multas duplicadas exactas (debido a repetición de fragmentos flotantes en pdfplumber)
    unique_multas = []
    seen = set()
    for m in multas:
        key = (m["periodo"], m["uf"], m["propietario"], m["motivo"], m["monto"])
        if key not in seen:
            seen.add(key)
            unique_multas.append(m)

    return expenses, balance_data, unique_multas

def detect_anomalies(expenses):
    concept_history = {}
    
    def normalize_concept(c):
        c_norm = c.lower()
        c_norm = re.sub(r'\b(0\d|1[0-2])/\d{4}\b', '', c_norm)
        c_norm = re.sub(r'\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b', '', c_norm)
        c_norm = re.sub(r'\b(abril|mayo|junio|julio|agosto)\b', '', c_norm)
        return " ".join(c_norm.split())

    for exp in expenses:
        norm = normalize_concept(exp["concepto"])
        if norm not in concept_history:
            concept_history[norm] = []
        concept_history[norm].append(exp["monto"])

    concept_averages = {}
    for norm, montos in concept_history.items():
        if len(montos) >= 2:
            concept_averages[norm] = sum(montos) / len(montos)

    for exp in expenses:
        norm = normalize_concept(exp["concepto"])
        avg = concept_averages.get(norm)
        if avg and avg > 10000 and exp["monto"] > (avg * 1.45):
            exp["anomalia"] = True
            exp["desviacion_pct"] = round(((exp["monto"] - avg) / avg) * 100)
        else:
            exp["anomalia"] = False
            exp["desviacion_pct"] = 0
            
    return expenses

def main():
    print("Iniciando análisis y extracción granular de gastos...")
    all_expenses = []
    all_balances = []
    all_multas = []

    if not os.path.exists(LIQUIDACIONES_DIR):
        print(f"ERROR: No existe el directorio {LIQUIDACIONES_DIR}")
        return

    files = [os.path.join(LIQUIDACIONES_DIR, f) for f in os.listdir(LIQUIDACIONES_DIR) 
             if f.endswith("_liquidacion.pdf")]
    
    print(f"Encontradas {len(files)} liquidaciones para procesar.")

    for filepath in sorted(files):
        print(f"   Procesando: {os.path.basename(filepath)}...")
        try:
            file_expenses, balance_data, file_multas = parse_pdf_expenses(filepath)
            all_expenses.extend(file_expenses)
            all_balances.append(balance_data)
            all_multas.extend(file_multas)
        except Exception as e:
            print(f"      [Error] al procesar {os.path.basename(filepath)}: {e}")

    all_expenses = detect_anomalies(all_expenses)

    output_data = {
        "gastos": all_expenses,
        "balances": all_balances,
        "multas": all_multas
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=4, ensure_ascii=False)

    print(f"\nExtracción finalizada. Se procesaron {len(all_expenses)} registros de gastos, {len(all_balances)} balances y {len(all_multas)} multas.")
    print(f"Datos estructurados guardados en: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
