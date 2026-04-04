"""
routes/graph_routes.py
Endpoints REST que exponen el grafo al frontend.
"""
from flask import Blueprint, jsonify, request
from backend.graph_engine import (
    load_data, build_graph, detect_communities,
    compute_metrics, graph_to_json,
    build_subgraph_franja, bridge_analysis,
    simulate_bridge_removal, franja_comparison_all
)

graph_bp = Blueprint("graph", __name__)

# Cache simple para no recalcular en cada request
_cache = {}


def _get_data():
    if "raw" not in _cache:
        _cache["raw"] = load_data()
    return _cache["raw"]


# ─────────────────────────────────────────────────────────────────
#  GET /api/graph
#  Parámetros query:
#    tipos_arista  (csv)  : voto_candidato_departamento,cobertura_medio_candidato,...
#    min_peso      (float): 0–100
#    resolution    (float): resolución Louvain (0.5–2.0)
# ─────────────────────────────────────────────────────────────────
@graph_bp.route("/graph")
def get_graph():
    nodos, aristas = _get_data()

    tipos_raw = request.args.get("tipos_arista", "")
    tipos = [t.strip() for t in tipos_raw.split(",") if t.strip()] or None
    min_peso = float(request.args.get("min_peso", 0.0))
    resolution = float(request.args.get("resolution", 1.0))

    G = build_graph(nodos, aristas, tipos_arista=tipos, min_peso=min_peso)
    partition = detect_communities(G, resolution=resolution)
    metrics = compute_metrics(G, partition)
    data = graph_to_json(G, partition, metrics)

    return jsonify(data)


# ─────────────────────────────────────────────────────────────────
#  GET /api/meta
#  Devuelve tipos de arista disponibles y rangos para controles UI
# ─────────────────────────────────────────────────────────────────
@graph_bp.route("/meta")
def get_meta():
    nodos, aristas = _get_data()
    tipos = aristas["tipo_arista"].unique().tolist()
    tipos_nodo = nodos["tipo"].unique().tolist()
    subtipos_franja = nodos[nodos["tipo"] == "franja_demografica"]["subtipo"].unique().tolist()
    candidatos = nodos[nodos["tipo"] == "candidato"][["node_id", "nombre", "subtipo"]].to_dict("records")
    medios = nodos[nodos["tipo"] == "medio"][["node_id", "nombre", "subtipo"]].to_dict("records")
    departamentos = nodos[nodos["tipo"] == "departamento"][["node_id", "nombre", "region"]].to_dict("records")

    return jsonify({
        "tipos_arista": tipos,
        "tipos_nodo": tipos_nodo,
        "subtipos_franja": subtipos_franja,
        "candidatos": candidatos,
        "medios": medios,
        "departamentos": departamentos,
        "peso_min": float(aristas["peso"].min()),
        "peso_max": float(aristas["peso"].max()),
    })


# ─────────────────────────────────────────────────────────────────
#  GET /api/bridges
#  Análisis de puentes — Reto 1
# ─────────────────────────────────────────────────────────────────
@graph_bp.route("/bridges")
def get_bridges():
    nodos, aristas = _get_data()
    tipos_raw = request.args.get("tipos_arista", "")
    tipos = [t.strip() for t in tipos_raw.split(",") if t.strip()] or None
    min_peso = float(request.args.get("min_peso", 0.0))
    resolution = float(request.args.get("resolution", 1.0))
    top_n = int(request.args.get("top_n", 8))

    G = build_graph(nodos, aristas, tipos_arista=tipos, min_peso=min_peso)
    partition = detect_communities(G, resolution=resolution)
    metrics = compute_metrics(G, partition)
    bridges = bridge_analysis(G, partition, metrics, top_n=top_n)

    return jsonify({"bridges": bridges})


# ─────────────────────────────────────────────────────────────────
#  GET /api/franja
#  Subgrafo por tipo de franja demográfica — Reto 2
# ─────────────────────────────────────────────────────────────────
@graph_bp.route("/franja")
def get_franja():
    nodos, aristas = _get_data()
    subtipo = request.args.get("subtipo", "edad")
    min_peso = float(request.args.get("min_peso", 0.0))
    resolution = float(request.args.get("resolution", 1.0))

    G = build_subgraph_franja(nodos, aristas, subtipo, min_peso)
    if len(G.nodes) < 2:
        return jsonify({"nodes": [], "edges": [], "metrics": {}})

    partition = detect_communities(G, resolution=resolution)
    metrics = compute_metrics(G, partition)
    data = graph_to_json(G, partition, metrics)
    return jsonify(data)


# ─────────────────────────────────────────────────────────────────
#  GET /api/compare
#  Reto 3: compara dos configuraciones del mismo análisis
# ─────────────────────────────────────────────────────────────────
@graph_bp.route("/compare")
def get_compare():
    nodos, aristas = _get_data()

    # Config A
    tipos_a = request.args.get("tipos_a", "voto_candidato_departamento")
    res_a = float(request.args.get("res_a", 0.8))
    min_a = float(request.args.get("min_a", 0.0))

    # Config B
    tipos_b = request.args.get("tipos_b", "voto_candidato_departamento,cobertura_medio_candidato,afinidad_franja_candidato")
    res_b = float(request.args.get("res_b", 1.2))
    min_b = float(request.args.get("min_b", 0.0))

    def build_and_analyze(tipos_str, res, min_p):
        tipos = [t.strip() for t in tipos_str.split(",") if t.strip()]
        G = build_graph(nodos, aristas, tipos_arista=tipos, min_peso=min_p)
        partition = detect_communities(G, resolution=res)
        metrics = compute_metrics(G, partition)
        return graph_to_json(G, partition, metrics)

    return jsonify({
        "config_a": {
            "label": f"Resolución {res_a} · {tipos_a}",
            "data": build_and_analyze(tipos_a, res_a, min_a)
        },
        "config_b": {
            "label": f"Resolución {res_b} · {tipos_b[:40]}…",
            "data": build_and_analyze(tipos_b, res_b, min_b)
        }
    })


# ─────────────────────────────────────────────────────────────────
#  GET /api/bridge_simulation?node_id=CAN_01&tipos_arista=...
#  Reto 1 — Simulación de eliminación de puente
# ─────────────────────────────────────────────────────────────────
@graph_bp.route("/bridge_simulation")
def get_bridge_simulation():
    nodos, aristas = _get_data()
    node_id   = request.args.get("node_id", "")
    tipos_raw = request.args.get("tipos_arista", "")
    tipos     = [t.strip() for t in tipos_raw.split(",") if t.strip()] or None
    min_peso  = float(request.args.get("min_peso", 0.0))
    resolution = float(request.args.get("resolution", 1.0))

    if not node_id:
        return jsonify({"error": "Parámetro node_id requerido"}), 400

    G         = build_graph(nodos, aristas, tipos_arista=tipos, min_peso=min_peso)
    partition = detect_communities(G, resolution=resolution)
    result    = simulate_bridge_removal(G, partition, node_id)
    return jsonify(result)


# ─────────────────────────────────────────────────────────────────
#  GET /api/franja_comparison?resolution=1.0
#  Reto 2 — Comparación de todos los criterios demográficos
# ─────────────────────────────────────────────────────────────────
@graph_bp.route("/franja_comparison")
def get_franja_comparison():
    nodos, aristas = _get_data()
    resolution = float(request.args.get("resolution", 1.0))
    results    = franja_comparison_all(nodos, aristas, resolution=resolution)
    return jsonify({"criterios": results})
