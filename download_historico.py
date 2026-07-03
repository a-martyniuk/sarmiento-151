import os
import base64
import requests
import re
from email.message import Message
from concurrent.futures import ThreadPoolExecutor

# Directorio de descargas local
DOWNLOAD_DIR = "liquidaciones"

# Usamos un email dummy en Base64 para cumplir con el requisito obligatorio de la API sin requerir accesos reales
DUMMY_EMAIL_B64 = base64.b64encode(b"dummy@administracionglobal.com").decode('utf-8')

def clean_filename(filename):
    if not filename:
        return None
    filename = filename.replace('"', '').replace("'", "")
    return re.sub(r'[\\/*?:"<>|]', "_", filename)

def try_download(payload_str):
    predicted_filename = f"{payload_str}.pdf"
    filepath = os.path.join(DOWNLOAD_DIR, predicted_filename)

    # REFUERZO DE RENDIMIENTO: Evitar llamadas de red si el archivo ya existe localmente
    if os.path.exists(filepath):
        return False # Retornamos False para no contarlo como nueva descarga

    # Encriptar el identificador predictivo de la expensa en Base64
    i_b64 = base64.b64encode(payload_str.encode('utf-8')).decode('utf-8')
    url = f"https://web.administracionglobal.com/api/Descargas/?i={i_b64}&m={DUMMY_EMAIL_B64}"

    try:
        # Petición GET con stream habilitado y timeout corto para máxima eficiencia
        response = requests.get(url, stream=True, timeout=10)
        if response.status_code != 200:
            return False

        # Validar en caliente los primeros bytes antes de procesar el archivo completo
        first_chunk = next(response.iter_content(chunk_size=1024), b"")
        if not first_chunk.startswith(b"%PDF"):
            return False

        # Obtener el nombre del archivo del encabezado o usar el predicho
        content_disposition = response.headers.get('Content-Disposition')
        filename = None
        if content_disposition:
            msg = Message()
            msg['content-disposition'] = content_disposition
            filename = msg.get_param('filename')

        if not filename:
            filename = response.url.split('/')[-1].split('?')[0]
            if not filename or '.' not in filename:
                filename = predicted_filename

        filename = clean_filename(filename)
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"

        final_filepath = os.path.join(DOWNLOAD_DIR, filename)

        # Doble verificación de existencia física por si el redireccionamiento cambió el nombre final
        if os.path.exists(final_filepath):
            return False

        print(f"   [Descargado] -> {filename}")
        with open(final_filepath, 'wb') as f:
            f.write(first_chunk)
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        return True
    except Exception:
        return False

def main():
    print(f"Iniciando barrido predictivo de alta performance...")
    print(f"Destino local: {DOWNLOAD_DIR}\n")

    if not os.path.exists(DOWNLOAD_DIR):
        os.makedirs(DOWNLOAD_DIR)

    # Rango de búsqueda: desde 2020 hasta el año y mes actuales
    import datetime
    now = datetime.datetime.now()
    current_year = now.year
    current_month = now.month

    years = range(2020, current_year + 1)
    months_list = [f"{m:02d}" for m in range(1, 13)]

    # Documentos que deseamos buscar
    doc_patterns = [
        "liquidacion",
        "avisos_0151-0026",
        "avisos_0151-0168",
        "recibos_unidad_0151-0026",
        "recibos_unidad_0151-0168"
    ]

    consorcio = "326"
    edificio = "151"

    # Generar payloads para revisar
    payloads_to_check = []
    for year in reversed(years):
        for month in months_list:
            # Omitir períodos futuros al mes corriente
            if year == current_year and int(month) > current_month:
                continue
            period = f"{year}-{month}"
            for doc in doc_patterns:
                payloads_to_check.append(f"{consorcio}_{edificio}_{period}_{doc}")

    print(f"Total combinaciones posibles a evaluar: {len(payloads_to_check)}")
    
    # Usamos concurrencia de alto rendimiento con 20 hilos en paralelo (ideal para GitHub Actions y red veloz)
    total_descargas = 0
    with ThreadPoolExecutor(max_workers=20) as executor:
        results = executor.map(try_download, payloads_to_check)
        for r in results:
            if r:
                total_descargas += 1

    print(f"\nProceso finalizado. Se descargaron {total_descargas} archivos nuevos.")

if __name__ == "__main__":
    main()
