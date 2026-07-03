import os
import re
import json
import pdfplumber

LIQUIDACIONES_DIR = "liquidaciones"
OUTPUT_JSON = "prorrateo.json"

def clean_amount(val_str):
    if not val_str:
        return 0.0
    val_str = val_str.replace(" ", "").replace(".", "").replace(",", ".")
    val_str = val_str.replace("%", "")
    try:
        return float(val_str)
    except ValueError:
        return 0.0

def parse_prorrateo_line(line):
    line = re.sub(r'\s+', ' ', line).strip()
    tokens = line.split(' ')
    
    if len(tokens) < 16:
        return None
    
    if not (re.match(r"^\d{3}$", tokens[0]) and re.match(r"^\d{3}$", tokens[-1])):
        return None
    
    uf = tokens[0]
    numeric_tokens = tokens[-15:]
    
    middle_tokens = tokens[1:-15]
    if len(middle_tokens) == 0:
        return None
        
    dpto_parts = []
    first_token = middle_tokens[0].upper()
    if first_token in ["SS", "LOC", "SEM"] and len(middle_tokens) > 1:
        dpto = f"{middle_tokens[0]} {middle_tokens[1]}"
        prop_tokens = middle_tokens[2:]
    elif re.match(r"^\d+$", first_token) and len(middle_tokens) > 1 and len(middle_tokens[1]) == 1:
        dpto = f"{middle_tokens[0]} {middle_tokens[1]}"
        prop_tokens = middle_tokens[2:]
    else:
        dpto = middle_tokens[0]
        prop_tokens = middle_tokens[1:]
        
    propietario = " ".join(prop_tokens).strip()
    
    try:
        return {
            "uf": int(uf),
            "dpto": dpto,
            "propietario": propietario,
            "saldo_anterior": clean_amount(numeric_tokens[0]),
            "pagos": clean_amount(numeric_tokens[1]),
            "deuda": clean_amount(numeric_tokens[2]),
            "interes": clean_amount(numeric_tokens[3]),
            "ga_pct": clean_amount(numeric_tokens[4]),
            "ga_monto": clean_amount(numeric_tokens[5]),
            "gb_pct": clean_amount(numeric_tokens[6]),
            "gb_monto": clean_amount(numeric_tokens[7]),
            "multa": clean_amount(numeric_tokens[8]),
            "gastos_extra": clean_amount(numeric_tokens[9]),
            "fondo_operativo_pct": clean_amount(numeric_tokens[10]),
            "fondo_operativo_monto": clean_amount(numeric_tokens[11]),
            "red_ajustes": clean_amount(numeric_tokens[12]),
            "total": clean_amount(numeric_tokens[13])
        }
    except Exception:
        return None

def parse_prorrateo_pdf(filepath):
    filename = os.path.basename(filepath)
    match_date = re.search(r"(\d{4})-(\d{2})", filename)
    if not match_date:
        return []
    
    period = f"{match_date.group(1)}-{match_date.group(2)}"
    records = []
    
    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if "ESTADO DE CUENTAS" not in text and "PRORRATEO" not in text:
                continue
            
            lines = text.split('\n')
            for line in lines:
                res = parse_prorrateo_line(line)
                if res:
                    res["periodo"] = period
                    records.append(res)
                    
    return records

def main():
    print("Iniciando extracción de Estado de Cuentas y Prorrateo por U.F. de los PDFs...")
    
    if not os.path.exists(LIQUIDACIONES_DIR):
        print(f"ERROR: No existe el directorio {LIQUIDACIONES_DIR}")
        return

    files = [os.path.join(LIQUIDACIONES_DIR, f) for f in os.listdir(LIQUIDACIONES_DIR) 
             if f.endswith("_liquidacion.pdf")]
    
    print(f"Encontradas {len(files)} liquidaciones para procesar.")
    
    all_records = []
    for filepath in sorted(files):
        print(f"   Procesando: {os.path.basename(filepath)}...")
        try:
            records = parse_prorrateo_pdf(filepath)
            all_records.extend(records)
            print(f"      -> Extraídas {len(records)} U.F.s")
        except Exception as e:
            print(f"      [Error] al procesar {os.path.basename(filepath)}: {e}")
            
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"prorrateo": all_records}, f, indent=4, ensure_ascii=False)
        
    print(f"\nExtracción finalizada. Se procesaron {len(all_records)} registros totales por U.F.")
    print(f"Datos estructurados de prorrateo guardados en: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
