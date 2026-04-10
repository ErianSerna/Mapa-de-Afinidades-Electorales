# 🗺️ Mapa de Afinidades Electorales — Colombia 2026
### Ejercicio 2A · Taller de Grafos · Matemáticas para la Informática Avanzada

---

## Tabla de contenidos
1. ➡️🎯[Instalación y ejecución](#instalacion)🎯⬅️ 
2. [Estructura de carpetas](#estructura)
3. [Arquitectura del proyecto](#arquitectura)
4. [Endpoints de la API](#api)
5. [Cómo conecta el frontend con el backend](#conexion)
6. [Decisiones de modelado del grafo](#modelado)
7. [Algoritmo de análisis: Louvain](#louvain)
8. [Retos innovadores implementados](#retos)
9. [Preguntas del ejercicio respondidas](#preguntas)
10. [Tecnologías usadas](#tecnologias)

---
## 1. Instalación y ejecución <a name="instalacion"></a>

### Requisitos
- Python 3.9+
- pip

### Pasos

```bash
# 1. Clonar / descomprimir el proyecto
cd Mapa-de-Afinidades-Electorales-main

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Ejecutar el servidor
python app.py

# 4. Abrir en el navegador
# http://localhost:5000

# 5. O en su defecto, entrar al siguiente link y esperar a que cargue el servicio (tiempo promedio de carga 1 minuto)
# https://mapa-de-afinidades-electorales.onrender.com

```

**Separación de responsabilidades (Single Responsibility Principle):**

| Capa | Archivo | Responsabilidad |
|------|---------|-----------------|
| Datos | `data/*.csv` | Fuente de verdad — nunca se modifica |
| Motor | `backend/graph_engine.py` | Lógica de grafos pura (sin HTTP) |
| API | `backend/routes/graph_routes.py` | Traducir HTTP ↔ motor |
| Servidor | `app.py` | Arrancar Flask, registrar blueprints |
| Vista | `frontend/index.html` | Estructura HTML declarativa |
| Estilos | `frontend/css/style.css` | Visual — sin lógica |
| Interacción | `frontend/js/script.js` | fetch + D3 — sin lógica de negocio |

---

## 2. Estructura de carpetas <a name="estructura"></a>

```
Mapa-de-Afinidades-Electorales-main/
│
├── app.py                        ← Punto de entrada Flask
├── requirements.txt              ← Dependencias Python
│
├── backend/
│   ├── __init__.py
│   ├── graph_engine.py           ← Lógica de grafos (NetworkX + Louvain)
│   └── routes/
│       ├── __init__.py
│       └── graph_routes.py       ← Endpoints REST
│
├── frontend/
│   ├── index.html                ← SPA (Single Page Application)
│   ├── css/
│   │   └── style.css             ← Estilos (sin datos hardcodeados)
│   └── js/
│       └── script.js             ← D3.js + fetch API
│
└── data/
    ├── electoral_nodos.csv       ← 60 nodos (candidatos, dptos, franjas, medios)
    └── electoral_aristas.csv     ← 404 aristas con pesos
```
## 3. Arquitectura del proyecto <a name="arquitectura"></a>

```
┌─────────────────────────────────────────────────────────┐
│                     NAVEGADOR                           │
│  index.html + style.css + script.js  (D3.js)           │
│                                                         │
│  fetch("/api/graph?resolution=1.0&tipos_arista=...")    │
└────────────────────┬────────────────────────────────────┘
                     │  HTTP/JSON
                     ▼
┌─────────────────────────────────────────────────────────┐
│               FLASK (app.py)                            │
│   /api/graph  →  graph_routes.py                       │
│   /api/meta   →  graph_routes.py                       │
│   /api/bridges→  graph_routes.py                       │
│   /api/franja →  graph_routes.py                       │
│   /api/compare→  graph_routes.py                       │
│                                                         │
│   graph_engine.py                                       │
│   ├── load_data()          ← lee los CSV               │
│   ├── build_graph()        ← NetworkX                   │
│   ├── detect_communities() ← Louvain                    │
│   ├── compute_metrics()    ← centralidades              │
│   └── graph_to_json()      ← serialización D3          │
└────────────────────┬────────────────────────────────────┘
                     │  pandas
                     ▼
┌─────────────────────────────────────────────────────────┐
│  data/electoral_nodos.csv                               │
│  data/electoral_aristas.csv                             │
└─────────────────────────────────────────────────────────┘
```

El servidor Flask sirve tanto la API como el frontend estático desde la misma URL.

---

## 4. Endpoints de la API <a name="api"></a>

Todos los endpoints devuelven **JSON**. No hay datos HTML generado por el servidor.

### `GET /api/graph`
Construye el grafo completo y aplica Louvain.

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `tipos_arista` | string (csv) | todos | Tipos de arista a incluir |
| `min_peso` | float | 0 | Peso mínimo de arista |
| `resolution` | float | 1.0 | Resolución Louvain (0.3–2.0) |

**Respuesta:**
```json
{
  "nodes": [
    { "id": "CAN_01", "nombre": "Paloma Valencia", "tipo": "candidato",
      "community": 0, "betweenness": 0.142, "degree": 0.85, ... }
  ],
  "edges": [
    { "source": "CAN_01", "target": "DEP_01", "peso": 47.98,
      "tipo": "voto_candidato_departamento" }
  ],
  "metrics": {
    "modularity": 0.267,
    "n_nodes": 60,
    "n_edges": 404,
    "n_communities": 3,
    "communities": {
      "0": { "id": 0, "size": 22, "density": 0.12,
             "bridge_nombre": "Paloma Valencia", ... }
    }
  }
}
```

### `GET /api/meta`
Metadatos del dataset para construir la UI dinámicamente.

### `GET /api/bridges?top_n=8`
Lista los N nodos con mayor betweenness centrality (nodos puente).

### `GET /api/franja?subtipo=edad&resolution=1.0`
Subgrafo filtrado por tipo de franja demográfica (edad / estrato / educacion / ruralidad).

---

## 5. Cómo conecta el frontend con el backend <a name="conexion"></a>

**Patrón: fetch + JSON → D3.js**

```javascript
// script.js — función principal de carga

async function loadAndRender() {
  showLoading(true);

  // 1. Lee parámetros de la UI (sliders, checkboxes)
  const params = getParams();
  const qs = new URLSearchParams(params).toString();

  // 2. Llama a la API (NO hay datos en el HTML)
  const resp = await fetch(`/api/graph?${qs}`);
  const data = await resp.json();   // { nodes, edges, metrics }

  // 3. Renderiza con D3.js
  renderGraph(data, "graph-canvas", "main");

  // 4. Actualiza panel de métricas
  updateMetricsPanel(data.metrics);

  showLoading(false);
}
```

**El HTML no contiene ningún dato electoral** — todo viene del endpoint `/api/graph`.

---

## 6. Decisiones de modelado del grafo <a name="modelado"></a>

### Tipo de grafo elegido: No dirigido ponderado

| Decisión | Justificación |
|----------|---------------|
| **No dirigido** | La afinidad entre un candidato y un departamento es mutua. El ecosistema de influencia no tiene un flujo unidireccional claro para el análisis de comunidades. |
| **Ponderado** | El peso diferencia una conexión fuerte (Paloma Valencia en Andina: 47%) de una débil (5%). Sin pesos, todos los nodos tendrían la misma influencia. |
| **Multitype** | Los 4 tipos de nodo (candidato, departamento, franja, medio) permiten preguntas cruzadas: ¿qué medios están en la misma comunidad que qué candidatos? |

### Definición del peso de cada tipo de arista

| Tipo | Peso | Significado |
|------|------|-------------|
| `voto_candidato_departamento` | % votos estimados (0–100) | Fortaleza electoral territorial |
| `cobertura_medio_candidato` | Índice 0–100 | Cobertura favorable del medio al candidato |
| `alcance_medio_departamento` | % de alcance regional | Penetración del medio en el departamento |
| `afinidad_franja_candidato` | % de afinidad demográfica | Cercanía entre perfil demográfico y candidato |

### Alternativa descartada: Grafo bipartito

Se evaluó construir grafos bipartitos (solo candidatos ↔ departamentos), pero esto perdería las conexiones mediáticas y demográficas que son centrales para las preguntas del ejercicio.

---

## 7. Algoritmo de análisis: Louvain <a name="louvain"></a>

### ¿Por qué Louvain?

1. **No requiere definir k** (número de comunidades) a priori — las detecta automáticamente.
2. **Optimiza modularidad** — maximiza la densidad interna de grupos vs. conexiones externas.
3. **Escala** — eficiente con grafos de cientos de nodos.
4. **El parámetro `resolution`** permite explorar el espacio de particiones (reto interactivo).

### Fórmula de modularidad

```
Q = (1/2m) Σᵢⱼ [ Aᵢⱼ - kᵢkⱼ/2m ] δ(cᵢ, cⱼ)
```

Donde `Aᵢⱼ` es el peso de la arista, `kᵢ` el grado ponderado del nodo i, `m` el total de pesos, y `δ(cᵢ,cⱼ)=1` si i y j están en la misma comunidad.

Un Q cercano a 1 indica partición de alta calidad. El dataset obtiene Q ≈ 0.27, lo que indica comunidades moderadamente separadas — esperado en una red política heterogénea.

---

## 8. Retos innovadores implementados <a name="retos"></a>

###  Reto 1 — Análisis de puentes (`/api/bridges`)
- Calcula **betweenness centrality** para todos los nodos.
- Identifica los N nodos que conectan comunidades distintas.
- El panel derecho muestra el ranking con porcentaje de intermediación.
- En el grafo, el **tamaño del nodo es proporcional al betweenness** — los puentes se ven grandes.

###  Reto 2 — Evolución por franja demográfica (`/api/franja`)
- Tab "Por franja": construye un **subgrafo solo con franjas del tipo elegido + candidatos**.
- Selector dinámico de subtipo: edad, estrato, educación, ruralidad, etnia.
- Permite comparar visualmente si la partición cambia según el criterio demográfico.

###  Reto 3 — Comparación de configuraciones (`/api/compare`)
- Tab "Comparar configs": renderiza **dos grafos lado a lado**.
- Config A: solo votos (resolución baja → menos comunidades).
- Config B: todos los tipos de arista (resolución alta → más comunidades).
- El usuario puede seleccionar cuál configuración considera más válida.

---

## 9. Preguntas del ejercicio respondidas <a name="preguntas"></a>

| Pregunta | Cómo la responde la app |
|----------|------------------------|
| ¿Qué departamentos votan similar? | Nodos `departamento` en la misma comunidad (mismo color) |
| ¿Coinciden los grupos con regiones geográficas? | El atributo `region` visible en el tooltip + color de comunidad |
| ¿Qué medios comparten ecosistema con qué candidatos? | Nodos `medio` y `candidato` en la misma comunidad |
| ¿Qué franja es más homogénea? | Tab "Por franja" — la franja con mayor modularidad es la más homogénea |
| ¿Qué tan pronunciada es la separación? | Métrica **Densidad** en el panel de métricas |

---

## 10. Tecnologías usadas <a name="tecnologias"></a>

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Backend | Python + Flask | 3.x / 3.0 |
| Grafos | NetworkX | 3.2+ |
| Comunidades | python-louvain | 0.16 |
| Datos | pandas | 2.1+ |
| Frontend | HTML5 + CSS3 + JavaScript | ES2020 |
| Visualización | D3.js | 7.8 |
| HTTP | fetch API (nativa) | — |
| CORS | flask-cors | 4.0 |
| gunicorn | -  | 21.2.0
---

## Notas de desarrollo

- Los datos **nunca se hardcodean** en el HTML. El frontend llama a `/api/graph` en cada render.
- El backend tiene un **cache simple en memoria** para no releer los CSV en cada request.
- Los parámetros de Louvain (`resolution`, `min_peso`, `tipos_arista`) permiten exploración interactiva sin recargar la página.
- La app maneja gracefully un grafo vacío (si los filtros son demasiado restrictivos).

---

*Ejercicio 2A · Grupo 190304003-1 · ITM Medellín · 2026*
