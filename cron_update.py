import os
import sys
import json
import datetime
import subprocess

def load_json(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def check_period_exists(period):
    # Verificar en gastos.json
    gastos = load_json("gastos.json")
    if gastos and "gastos" in gastos:
        if any(e.get("periodo") == period for e in gastos["gastos"]):
            return True
    return False

def main():
    mode = "--services-only"
    if len(sys.argv) > 1:
        mode = sys.argv[1]

    print(f"[{datetime.datetime.now().isoformat()}] Iniciando script de actualización (Modo: {mode})...")

    # Siempre ejecutar la verificación de servicios (Luz, Agua y Gas)
    print("Ejecutando monitoreo de servicios locales...")
    subprocess.run([sys.executable, "check_servicios.py"], check=True)

    if mode == "--all":
        # Determinar el período esperado (mes anterior al corriente)
        now = datetime.datetime.now()
        # Si es enero, el mes anterior es diciembre del año pasado
        if now.month == 1:
            expected_period = f"{now.year - 1}-12"
        else:
            expected_period = f"{now.year}-{now.month - 1:02d}"

        print(f"Período de expensas esperado para descargar: {expected_period}")

        # Comprobar si ya tenemos datos para ese período
        if check_period_exists(expected_period):
            print(f"El período {expected_period} ya se encuentra disponible y con datos. Se cancela la descarga repetida.")
        else:
            print(f"El período {expected_period} no está cargado. Buscando nuevas liquidaciones en el portal...")
            
            # 1. Ejecutar descarga de PDFs desde el portal de la administración
            # Modificamos temporalmente el script de descarga para usar rutas relativas si corre en Actions
            import download_historico
            
            # Modificar la constante DOWNLOAD_DIR dinámicamente si es necesario
            download_historico.DOWNLOAD_DIR = "liquidaciones"
            
            # Ejecutar el main de descarga
            download_historico.main()

            # Verificar si se descargó el PDF de la nueva liquidación
            expected_pdf_name = f"326_151_{expected_period}_liquidacion.pdf"
            pdf_path = os.path.join("liquidaciones", expected_pdf_name)

            if os.path.exists(pdf_path):
                print(f"¡Nueva liquidación detectada: {expected_pdf_name}! Procesando y parseando PDF...")
                
                # 2. Ejecutar extractores de datos
                print("Ejecutando extract_data.py...")
                subprocess.run([sys.executable, "extract_data.py"], check=True)
                
                print("Ejecutando extract_prorrateo.py...")
                subprocess.run([sys.executable, "extract_prorrateo.py"], check=True)
                
                print("Datos actualizados con éxito en gastos.json y prorrateo.json.")
            else:
                print(f"Aún no está disponible la liquidación {expected_pdf_name} en el portal de la administración.")

if __name__ == "__main__":
    main()
