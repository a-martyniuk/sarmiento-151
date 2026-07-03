import pdfplumber

filepath = r"D:\Projects\Administracion_Sarmiento151\liquidaciones\326_151_2026-07_liquidacion.pdf"
with pdfplumber.open(filepath) as pdf:
    print(f"Total páginas: {len(pdf.pages)}")
    for i, page in enumerate(pdf.pages):
        print(f"\n--- PÁGINA {i+1} ---")
        text = page.extract_text()
        print(text[:1500])  # imprimir los primeros 1500 caracteres
