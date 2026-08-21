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

CANONICAL_UF_MAP = {
    1: 'SS 67', 2: 'SS 66', 3: 'LOC 3', 4: 'SS 40', 5: 'SS 41', 6: 'SS 42', 7: 'SS 43', 8: 'SS 44', 9: 'SS 45', 10: 'SS 46',
    11: 'SS 47', 12: 'SS 48', 13: 'SS 49', 14: 'SS 50', 15: 'SS 51', 16: 'SS 52', 17: 'SS 53', 18: 'SS 54', 19: 'SS 55', 20: 'SS 56',
    21: 'SS 57', 22: 'SS 58', 23: 'SS 59', 24: 'SS 60', 25: 'SS 61', 26: 'SS 62', 27: 'SS 63', 28: 'SS 64', 29: 'SS 65', 30: 'SS 68',
    31: 'SS 69', 32: 'SS 70', 33: 'SS 71', 34: 'SS 72', 35: 'SS 73', 36: 'SS 74', 37: 'SS 75', 38: 'LOC 1', 39: 'LOC 2', 40: 'SEM 1',
    41: 'SEM 2', 42: 'SEM 3', 43: 'SEM 4', 44: 'SEM 5', 45: 'SEM 6', 46: 'SEM 7', 47: 'SEM 8', 48: 'SEM 9', 49: 'SEM 10', 50: 'SEM 11',
    51: 'SEM 12', 52: 'SEM 13', 53: 'SEM 14', 54: 'SEM 15', 55: 'SEM 16', 56: 'SEM 17', 57: 'SEM 18', 58: 'SEM 19', 59: 'SEM 20', 60: 'SEM 21',
    61: 'SEM 22', 62: 'SEM 23', 63: 'SEM 24', 64: 'SEM 25', 65: 'SEM 26', 66: 'SEM 27', 67: 'SEM 28', 68: 'SEM 29', 69: 'SEM 38', 70: 'SEM 37',
    71: 'SEM 36', 72: 'SEM 35', 73: 'SEM 34', 74: 'SEM 33', 75: 'SEM 32', 76: 'SEM 31', 77: 'SEM 30', 78: '1 C', 79: '1 B', 80: '1 A',
    81: '1 E', 82: '1 D', 83: '2 C', 84: '2 B', 85: '2 A', 86: '2 E', 87: '2 D', 88: '3 C', 89: '3 B', 90: '3 A',
    91: '3 E', 92: '3 D', 93: '4 C', 94: '4 B', 95: '4 A', 96: '4 E', 97: '4 D', 98: '5 C', 99: '5 B', 100: '5 A',
    101: '5 E', 102: '5 D', 103: '6 C', 104: '6 B', 105: '6 A', 106: '6 E', 107: '6 D', 108: '7 C', 109: '7 B', 110: '7 A',
    111: '7 E', 112: '7 D', 113: '8 C', 114: '8 B', 115: '8 A', 116: '8 E', 117: '8 D', 118: '9 C', 119: '9 B', 120: '9 A',
    121: '9 E', 122: '9 D', 123: '10 C', 124: '10 B', 125: '10 A', 126: '10 E', 127: '10 D', 128: '11 C', 129: '11 B', 130: '11 A',
    131: '11 E', 132: '11 D', 133: '12 C', 134: '12 B', 135: '12 A', 136: '12 E', 137: '12 D', 138: '13 C', 139: '13 B', 140: '13 A',
    141: '13 E', 142: '13 D', 143: '14 C', 144: '14 B', 145: '14 A', 146: '14 E', 147: '14 D', 148: '15 C', 149: '15 B', 150: '15 A',
    151: '15 E', 152: '15 D', 153: '16 C', 154: '16 B', 155: '16 A', 156: '16 E', 157: '16 D', 158: '17 C', 159: '17 B', 160: '17 A',
    161: '17 E', 162: '17 D', 163: '18 C', 164: '18 B', 165: '18 A', 166: '18 E', 167: '18 D', 168: '19 C', 169: '19 B', 170: '19 A',
    171: '19 E', 172: '19 D', 173: '20 A', 174: '20 B', 175: '21 A', 176: '21 B', 177: '22 A', 178: '22 B', 179: '23 A', 180: '23 B',
    181: '24 A', 182: '24 B', 183: '25 A', 184: '25 B', 185: '26 A', 186: '26 B'
}

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
        
    uf_num = int(uf)
    canonical = CANONICAL_UF_MAP.get(uf_num)
    first_token = middle_tokens[0].upper()
    
    if first_token in ["SS", "LOC", "SEM"] and len(middle_tokens) > 1 and middle_tokens[1].isdigit():
        dpto = f"{middle_tokens[0]} {middle_tokens[1]}"
        prop_tokens = middle_tokens[2:]
    elif re.match(r"^\d+$", first_token) and len(middle_tokens) > 1 and len(middle_tokens[1]) == 1 and middle_tokens[1].isalpha():
        dpto = f"{middle_tokens[0]} {middle_tokens[1]}"
        prop_tokens = middle_tokens[2:]
    else:
        if canonical:
            dpto = canonical
            if first_token in ["SS", "SEM", "LOC", "BAU"] and len(middle_tokens) > 1:
                prop_tokens = middle_tokens[1:]
            else:
                prop_tokens = middle_tokens
        else:
            dpto = middle_tokens[0]
            prop_tokens = middle_tokens[1:]
            
    if canonical:
        dpto = canonical
        
    propietario = " ".join(prop_tokens).strip()
    
    try:
        return {
            "uf": uf_num,
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
    if match_date:
        period = f"{match_date.group(1)}-{match_date.group(2)}"
    else:
        match_date_rev = re.search(r"(\d{2})[-_](\d{4})", filename)
        if match_date_rev:
            period = f"{match_date_rev.group(2)}-{match_date_rev.group(1)}"
        else:
            return []
    
    records = []
    
    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text or ("ESTADO DE CUENTAS" not in text and "PRORRATEO" not in text):
                continue
            
            lines = text.split('\n')
            for line in lines:
                res = parse_prorrateo_line(line)
                if res:
                    res["periodo"] = period
                    records.append(res)
                    
    return records

def get_period_from_filename(filename):
    match_date = re.search(r"(\d{4})-(\d{2})", filename)
    if match_date:
        return f"{match_date.group(1)}-{match_date.group(2)}"
    match_date_rev = re.search(r"(\d{2})[-_](\d{4})", filename)
    if match_date_rev:
        return f"{match_date_rev.group(2)}-{match_date_rev.group(1)}"
    return None

def main():
    print("Iniciando extracción de Estado de Cuentas y Prorrateo por U.F. de los PDFs...")
    
    if not os.path.exists(LIQUIDACIONES_DIR):
        print(f"ERROR: No existe el directorio {LIQUIDACIONES_DIR}")
        return

    files_by_period = {}
    for f in os.listdir(LIQUIDACIONES_DIR):
        if f.endswith("_liquidacion.pdf"):
            p = get_period_from_filename(f)
            if p:
                files_by_period[p] = os.path.join(LIQUIDACIONES_DIR, f)
            
    excepciones_dir = os.path.join(LIQUIDACIONES_DIR, "Excepciones")
    if os.path.exists(excepciones_dir):
        for f in os.listdir(excepciones_dir):
            if f.lower().endswith(".pdf"):
                p = get_period_from_filename(f)
                if p:
                    files_by_period[p] = os.path.join(excepciones_dir, f)
                
    files = [files_by_period[p] for p in sorted(files_by_period.keys())]
    print(f"Encontradas {len(files)} liquidaciones consolidadas para procesar.")
    
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
