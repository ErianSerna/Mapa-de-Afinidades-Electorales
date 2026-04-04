"""
graph_engine.py
Lógica central: carga los CSV, construye el grafo NetworkX,
aplica Louvain, calcula métricas de centralidad y devuelve
estructuras listas para serializar a JSON.
"""
import os
import math
import pandas as pd
import networkx as nx
import numpy as np
import community as community_louvain   # python-louvain
from collections import defaultdict


def _to_python(obj):
    """Convierte tipos numpy a tipos Python nativos para JSON."""
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return obj

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


# ─────────────────────────────────────────────────────────────────
#  CARGA DE DATOS
# ─────────────────────────────────────────────────────────────────
def load_data():
    nodos = pd.read_csv(os.path.join(DATA_DIR, "electoral_nodos.csv"))
    aristas = pd.read_csv(os.path.join(DATA_DIR, "electoral_aristas.csv"))
    return nodos, aristas


# ─────────────────────────────────────────────────────────────────
#  CONSTRUCCIÓN DEL GRAFO
# ─────────────────────────────────────────────────────────────────
def build_graph(nodos: pd.DataFrame, aristas: pd.DataFrame,
                tipos_arista=None, min_peso=0.0):
    """
    Construye un grafo no dirigido ponderado.
    - tipos_arista: lista de tipos de arista a incluir (None = todos)
    - min_peso: umbral mínimo de peso para incluir una arista
    """
    G = nx.Graph()

    # Agregar nodos con atributos
    for _, row in nodos.iterrows():
        G.add_node(row["node_id"],
                   nombre=row["nombre"],
                   tipo=row["tipo"],
                   subtipo=str(row.get("subtipo", "")),
                   region=str(row.get("region", "")),
                   atributo_1=str(row.get("atributo_1", "")),
                   atributo_1_label=str(row.get("atributo_1_label", "")),
                   atributo_2=str(row.get("atributo_2", "")),
                   atributo_2_label=str(row.get("atributo_2_label", "")))

    # Filtrar aristas
    df = aristas.copy()
    if tipos_arista:
        df = df[df["tipo_arista"].isin(tipos_arista)]
    df = df[df["peso"] >= min_peso]

    for _, row in df.iterrows():
        src, dst = row["origen"], row["destino"]
        if src in G.nodes and dst in G.nodes:
            peso = float(row["peso"])
            if G.has_edge(src, dst):
                # Si ya existe, promedia los pesos
                G[src][dst]["peso"] = (G[src][dst]["peso"] + peso) / 2
            else:
                G.add_edge(src, dst,
                           peso=peso,
                           tipo=row["tipo_arista"],
                           fuente=str(row.get("fuente_dato", "")))
    return G


# ─────────────────────────────────────────────────────────────────
#  DETECCIÓN DE COMUNIDADES (Louvain)
# ─────────────────────────────────────────────────────────────────
def detect_communities(G: nx.Graph, resolution: float = 1.0):
    """
    Aplica algoritmo de Louvain con el parámetro 'resolution'.
    Mayor resolution → más comunidades pequeñas.
    Retorna dict {node_id: community_id}
    """
    if len(G.edges) == 0:
        return {n: 0 for n in G.nodes}
    
    weight_dict = {(u, v): d["peso"] for u, v, d in G.edges(data=True)}
    partition = community_louvain.best_partition(
        G, weight="peso", resolution=resolution, random_state=42)
    return partition


# ─────────────────────────────────────────────────────────────────
#  MÉTRICAS DE LA RED
# ─────────────────────────────────────────────────────────────────
def compute_metrics(G: nx.Graph, partition: dict):
    """Calcula centralidades y métricas por comunidad."""
    
    # Centralidad de intermediación (betweenness)
    betweenness = nx.betweenness_centrality(G, weight="peso", normalized=True)
    
    # Centralidad de grado ponderado
    degree_centrality = dict(G.degree(weight="peso"))
    max_deg = max(degree_centrality.values()) if degree_centrality else 1
    degree_centrality = {k: v / max_deg for k, v in degree_centrality.items()}

    # Modularidad de la partición
    modularity = community_louvain.modularity(partition, G, weight="peso")

    # Agrupa nodos por comunidad
    communities = defaultdict(list)
    for node, comm in partition.items():
        communities[comm].append(node)

    # Perfil de cada comunidad
    comm_profiles = {}
    for comm_id, members in communities.items():
        tipos = [G.nodes[n]["tipo"] for n in members]
        nombres = [G.nodes[n]["nombre"] for n in members]
        subtipos = [G.nodes[n].get("subtipo", "") for n in members]
        
        # Densidad interna
        subg = G.subgraph(members)
        density = nx.density(subg)
        
        # Nodo puente: el de mayor betweenness en la comunidad
        bridge = max(members, key=lambda n: betweenness.get(n, 0))
        
        comm_profiles[int(comm_id)] = {
            "id": int(comm_id),
            "size": int(len(members)),
            "density": round(float(density), 4),
            "tipos": {k: int(v) for k, v in pd.Series(tipos).value_counts().items()},
            "subtipo_dominante": str(pd.Series(subtipos).mode()[0]) if subtipos else "",
            "bridge_node": bridge,
            "bridge_nombre": G.nodes[bridge]["nombre"],
            "nombres": nombres
        }

    return {
        "betweenness": betweenness,
        "degree": degree_centrality,
        "modularity": round(modularity, 4),
        "communities": comm_profiles,
        "n_communities": len(communities)
    }


# ─────────────────────────────────────────────────────────────────
#  SERIALIZACIÓN PARA JSON (D3-friendly)
# ─────────────────────────────────────────────────────────────────
def graph_to_json(G: nx.Graph, partition: dict, metrics: dict):
    """Convierte grafo + métricas a estructura JSON para D3/vis."""
    
    nodes_json = []
    for node_id, attrs in G.nodes(data=True):
        comm = partition.get(node_id, -1)
        nodes_json.append({
            "id": node_id,
            "nombre": attrs.get("nombre", node_id),
            "tipo": attrs.get("tipo", ""),
            "subtipo": attrs.get("subtipo", ""),
            "region": attrs.get("region", ""),
            "atributo_1": attrs.get("atributo_1", ""),
            "atributo_1_label": attrs.get("atributo_1_label", ""),
            "atributo_2": attrs.get("atributo_2", ""),
            "atributo_2_label": attrs.get("atributo_2_label", ""),
            "community": int(partition.get(node_id, -1)),
            "betweenness": round(float(metrics["betweenness"].get(node_id, 0)), 4),
            "degree": round(float(metrics["degree"].get(node_id, 0)), 4),
        })

    edges_json = []
    for u, v, attrs in G.edges(data=True):
        edges_json.append({
            "source": u,
            "target": v,
            "peso": round(attrs.get("peso", 1.0), 3),
            "tipo": attrs.get("tipo", ""),
            "fuente": attrs.get("fuente", "")
        })

    return {
        "nodes": nodes_json,
        "edges": edges_json,
        "metrics": {
            "modularity": float(metrics["modularity"]),
            "n_nodes": int(len(nodes_json)),
            "n_edges": int(len(edges_json)),
            "n_communities": int(metrics["n_communities"]),
            "communities": {str(k): v for k, v in metrics["communities"].items()}
        }
    }


# ─────────────────────────────────────────────────────────────────
#  SUBGRAFO POR FRANJA DEMOGRÁFICA (Reto 2)
# ─────────────────────────────────────────────────────────────────
def build_subgraph_franja(nodos, aristas, subtipo_franja: str,
                           min_peso: float = 0.0):
    """
    Construye subgrafo filtrando solo franjas del subtipo indicado
    + candidatos. Para el análisis de reto 2.
    """
    # Nodos elegibles: franjas del subtipo + candidatos
    franjas = nodos[(nodos["tipo"] == "franja_demografica") &
                    (nodos["subtipo"] == subtipo_franja)]["node_id"].tolist()
    candidatos = nodos[nodos["tipo"] == "candidato"]["node_id"].tolist()
    elegibles = set(franjas + candidatos)

    # Filtrar aristas de afinidad_franja_candidato
    df = aristas[aristas["tipo_arista"] == "afinidad_franja_candidato"].copy()
    df = df[(df["origen"].isin(elegibles)) & (df["destino"].isin(elegibles))]
    df = df[df["peso"] >= min_peso]

    G = nx.Graph()
    for nid in elegibles:
        row = nodos[nodos["node_id"] == nid].iloc[0]
        G.add_node(nid,
                   nombre=row["nombre"],
                   tipo=row["tipo"],
                   subtipo=str(row.get("subtipo", "")),
                   region=str(row.get("region", "")),
                   atributo_1=str(row.get("atributo_1", "")),
                   atributo_1_label=str(row.get("atributo_1_label", "")),
                   atributo_2=str(row.get("atributo_2", "")),
                   atributo_2_label=str(row.get("atributo_2_label", "")))
    for _, row in df.iterrows():
        G.add_edge(row["origen"], row["destino"],
                   peso=float(row["peso"]),
                   tipo=row["tipo_arista"])
    return G


# ─────────────────────────────────────────────────────────────────
#  ANÁLISIS DE PUENTES (Reto 1)
# ─────────────────────────────────────────────────────────────────
def bridge_analysis(G: nx.Graph, partition: dict, metrics: dict, top_n=5):
    """
    Identifica los top-N nodos puente (mayor betweenness intercomunidad).
    """
    nodos_sorted = sorted(metrics["betweenness"].items(),
                          key=lambda x: x[1], reverse=True)
    bridges = []
    for node_id, bc in nodos_sorted[:top_n]:
        if node_id not in G.nodes:
            continue
        comm_vecinas = set(partition[nb] for nb in G.neighbors(node_id)
                           if nb in partition) - {partition.get(node_id)}
        bridges.append({
            "id": node_id,
            "nombre": G.nodes[node_id]["nombre"],
            "tipo": G.nodes[node_id]["tipo"],
            "betweenness": round(float(bc), 4),
            "community": int(partition.get(node_id, -1)),
            "comunidades_conectadas": [int(c) for c in comm_vecinas],
            "grado": int(G.degree(node_id))
        })
    return bridges


# ─────────────────────────────────────────────────────────────────
#  RETO 1 — Simulación de eliminación de puente
# ─────────────────────────────────────────────────────────────────
def simulate_bridge_removal(G: nx.Graph, partition: dict, node_id: str):
    """
    Simula qué ocurre al eliminar un nodo puente del grafo.
    Devuelve comparación antes/después: componentes, modularidad, vecinos afectados.
    """
    if node_id not in G.nodes:
        return {"error": f"Nodo '{node_id}' no encontrado"}

    nombre  = G.nodes[node_id]["nombre"]
    tipo    = G.nodes[node_id]["tipo"]
    vecinos = list(G.neighbors(node_id))

    # ── ANTES ────────────────────────────────────────────────
    comps_antes   = list(nx.connected_components(G))
    n_comps_antes = len(comps_antes)
    mod_antes     = round(float(community_louvain.modularity(partition, G, weight="peso")), 4)

    # ── DESPUÉS ──────────────────────────────────────────────
    G2 = G.copy()
    G2.remove_node(node_id)

    comps_despues   = list(nx.connected_components(G2))
    n_comps_despues = len(comps_despues)

    if len(G2.edges) > 0 and len(G2.nodes) > 1:
        partition2  = community_louvain.best_partition(G2, weight="peso", random_state=42)
        mod_despues = round(float(community_louvain.modularity(partition2, G2, weight="peso")), 4)
    else:
        partition2  = {n: i for i, comp in enumerate(comps_despues) for n in comp}
        mod_despues = 0.0

    # Serializar componentes ordenadas por tamaño
    comps_info = []
    for idx, comp in enumerate(sorted(comps_despues, key=len, reverse=True)):
        nombres_comp = [G2.nodes[n]["nombre"] for n in comp if n in G2.nodes]
        tipos_comp   = dict(pd.Series([G2.nodes[n]["tipo"]
                                       for n in comp if n in G2.nodes]).value_counts())
        comps_info.append({
            "id": idx,
            "size": int(len(comp)),
            "nombres": nombres_comp[:8],
            "hay_mas": len(nombres_comp) > 8,
            "tipos": {k: int(v) for k, v in tipos_comp.items()}
        })

    # Vecinos afectados
    vecinos_info = []
    for nb in vecinos:
        if nb in G2.nodes:
            vecinos_info.append({
                "id": nb,
                "nombre": G2.nodes[nb]["nombre"],
                "tipo": G2.nodes[nb]["tipo"],
                "nueva_comunidad": int(partition2.get(nb, -1))
            })

    return {
        "nodo_eliminado": {"id": node_id, "nombre": nombre, "tipo": tipo},
        "antes": {
            "n_componentes": int(n_comps_antes),
            "modularity": mod_antes,
        },
        "despues": {
            "n_componentes": int(n_comps_despues),
            "modularity": mod_despues,
            "delta_componentes": int(n_comps_despues - n_comps_antes),
            "delta_modularity": round(mod_despues - mod_antes, 4),
        },
        "componentes": comps_info,
        "vecinos_afectados": vecinos_info
    }


# ─────────────────────────────────────────────────────────────────
#  RETO 2 — Comparación de criterios de franja
# ─────────────────────────────────────────────────────────────────
def franja_comparison_all(nodos: pd.DataFrame, aristas: pd.DataFrame,
                           resolution: float = 1.0):
    """
    Para cada subtipo de franja construye el subgrafo y calcula:
    modularidad, n_comunidades, densidad_media y un score_claridad compuesto.
    Permite comparar cuál criterio demográfico produce la partición más clara.
    """
    subtipos = nodos[nodos["tipo"] == "franja_demografica"]["subtipo"].unique().tolist()
    results  = []

    for subtipo in subtipos:
        G = build_subgraph_franja(nodos, aristas, subtipo)
        if len(G.nodes) < 2 or len(G.edges) == 0:
            results.append({
                "subtipo": subtipo,
                "n_nodos": int(len(G.nodes)),
                "n_aristas": 0,
                "n_comunidades": 0,
                "modularity": 0.0,
                "densidad_media": 0.0,
                "score_claridad": 0.0,
                "pct_score": 0.0,
            })
            continue

        partition = community_louvain.best_partition(
            G, weight="peso", resolution=resolution, random_state=42)
        mod = float(community_louvain.modularity(partition, G, weight="peso"))

        comunidades = defaultdict(list)
        for n, c in partition.items():
            comunidades[c].append(n)

        densidades = [nx.density(G.subgraph(members)) for members in comunidades.values()]
        densidad_media = float(np.mean(densidades)) if densidades else 0.0

        # Score compuesto: modularidad (70%) + densidad interna (30%)
        score = round((mod * 0.7 + densidad_media * 0.3), 4)

        results.append({
            "subtipo": subtipo,
            "n_nodos": int(len(G.nodes)),
            "n_aristas": int(len(G.edges)),
            "n_comunidades": int(len(comunidades)),
            "modularity": round(mod, 4),
            "densidad_media": round(densidad_media, 4),
            "score_claridad": score,
            "pct_score": 0.0,   # se rellena abajo
        })

    # Normaliza a 0–100 para barras visuales
    results.sort(key=lambda x: x["score_claridad"], reverse=True)
    max_score = max(r["score_claridad"] for r in results) or 1.0
    for r in results:
        r["pct_score"] = round(r["score_claridad"] / max_score * 100, 1)

    return results
