# 📊 Sarmiento 151 — Dashboard de Expensas y Auditoría Independiente

Este es un panel de control y auditoría de expensas, gastos e infraestructura para el consorcio **Sarmiento 151** (Lomas de Zamora, Provincia de Buenos Aires). Se trata de una solución estática e independiente desarrollada por un copropietario para transparentar la información financiera y monitorear los servicios esenciales del edificio.

Acceso al sitio en producción: **[alexismartyniuk.com.ar/sarmiento-151](https://alexismartyniuk.com.ar/sarmiento-151)**

---

## 🚀 Arquitectura y Tecnologías
La plataforma está diseñada con una arquitectura liviana, de alto rendimiento y puramente estática para asegurar costos de infraestructura cero, máxima velocidad y seguridad frente a ataques.

* **Frontend:**
  * **HTML5 Semántico:** Estructura limpia y accesible.
  * **Vanilla CSS (Variables CSS):** Diseño responsive de alta estética premium en modo oscuro, con difuminado blur y animaciones fluidas sin dependencias pesadas.
  * **Vanilla JavaScript (ES6+):** Lógica pura para filtrado dinámico, procesamiento de datos, cálculos en vivo y control de estados de la UI.
  * **ApexCharts (CDN):** Visualizaciones interactivas de series temporales y distribución patrimonial.
* **Backend de Ingesta (Local):**
  * Scripts en **Python** para procesar, limpiar y parsear los datos brutos extraídos de los PDFs de expensas de la administración oficiales hacia archivos relacionales `gastos.json` y `prorrateo.json`.
* **Monitoreo en Tiempo Real (Serverless API):**
  * **check_servicios.py:** Script de Python encargado de auditar la red de servicios locales (Luz con Edesur, Agua con AySA y Gas con Metrogas) para alertar interrupciones activas en la zona de Lomas de Zamora.

---

## 📁 Estructura del Proyecto
```
Sarmiento151/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Pipeline de CI/CD para GitHub Pages
├── scratch/                    # Scripts temporales de diagnóstico
├── check_servicios.py          # Script de monitoreo de Luz, Agua y Gas
├── extract_data.py             # Parser principal de datos de expensas
├── extract_prorrateo.py        # Parser de expensas por U.F.
├── gastos.json                 # Base de datos consolidada de gastos
├── prorrateo.json              # Base de datos consolidada de U.F. e intereses
├── index.html                  # Panel de Control General de Gastos
├── dashboard.js                # Lógica del dashboard de gastos
├── unidades.html               # Panel de control de Unidades Funcionales
├── unidades.js                 # Lógica e interés punitorio por U.F.
├── robots.txt                  # Directivas de buscadores para SEO
├── sitemap.xml                 # Mapa del sitio para buscadores
├── LICENSE                     # Licencia del proyecto (MIT)
└── README.md                   # Documentación técnica
```

---

## 🛠️ Instalación y Ejecución Local

Para ejecutar el proyecto localmente sin instalar dependencias:

1. Clonar el repositorio.
2. Iniciar un servidor web local en el puerto `8000` desde la raíz del proyecto para evitar restricciones de políticas CORS al cargar los archivos JSON:
   ```bash
   python -m http.server 8000
   ```
3. Abrir el navegador e ingresar a: `http://localhost:8000`

---

## 🔄 Integración Continua y Despliegue (GitHub Actions)

El proyecto cuenta con un workflow de despliegue automático en la subruta del dominio personalizado:

* **Pipeline (.github/workflows/deploy.yml):** Se dispara de forma automática ante cada `git push` a la rama `main`.
* **Proceso de Despliegue:**
  1. Descarga el repositorio mediante `actions/checkout`.
  2. Sube y despliega de forma nativa todo el contenido del directorio en la rama `gh-pages`.
  3. GitHub Pages lo sirve de forma directa en el subdirectorio de producción.
