"""
app.py  —  punto de entrada Flask
Ejecutar:  python app.py
"""
import os
from flask import Flask, send_from_directory
from flask_cors import CORS

# Ajusta sys.path para que los imports relativos funcionen
import sys
sys.path.insert(0, os.path.dirname(__file__))

from backend.routes.graph_routes import graph_bp

app = Flask(
    __name__,
    static_folder="frontend",
    static_url_path=""
)
CORS(app)   # Permite llamadas desde el navegador (CORS abierto en dev)

# Registrar blueprints con prefijo /api
app.register_blueprint(graph_bp, url_prefix="/api")


# ── Sirve el frontend directamente ──────────────────────────────
@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")


@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory("frontend", path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n🗺️  Electoral 2A — corriendo en http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
    #app.run(debug=True, port=port) 
