from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# ---------- SUPABASE POSTGRESQL CONNECTION ----------
def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=os.getenv('SUPABASE_HOST', 'aws-1-ap-northeast-1.pooler.supabase.com'),
            port=os.getenv('SUPABASE_PORT', '5432'),
            user=os.getenv('SUPABASE_USER', 'postgres.cunyvhfzjuajglzuovda'),
            password=os.getenv('SUPABASE_PASSWORD', 'Smart_museum@123'),
            database=os.getenv('SUPABASE_DATABASE', 'postgres'),
            sslmode='require'  # Required for Supabase
        )
        return conn
    except Exception as e:
        print(f"❌ Database connection error: {e}")
        return None

# ---------- ROUTES ----------

# Home (chatbot page)
@app.route("/")
def home():
    return render_template("base.html")



@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    msg = data.get("message", "").lower()

    if "hello" in msg:
        reply = "Hello! Welcome 😊"
    elif "museum" in msg:
        reply = "You can explore museums like Albert Hall!"
    else:
        reply = "I didn't understand that."

    return jsonify({"reply": reply})



# Booking page
@app.route("/book.html")
def book_page():
    return render_template("book.html")

# 1️⃣ Get all museums (id + name)
@app.route("/get_museums")
def get_museums():
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, name, city FROM museums ORDER BY id")
        museums = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(museums)
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# 2️⃣ Get museum details + Adult/Child prices
@app.route("/get_museum_details/<int:museum_id>")
def get_museum_details(museum_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # ---- Museum basic info ----
        cursor.execute("""
            SELECT name, description, open_time, close_time, address, city, category
            FROM museums
            WHERE id = %s
        """, (museum_id,))
        museum = cursor.fetchone()

        if not museum:
            cursor.close()
            conn.close()
            return jsonify({"error": "Museum not found"}), 404

        # ---- Ticket prices ----
        cursor.execute("""
            SELECT type, price
            FROM tickets
            WHERE museum_id = %s
        """, (museum_id,))
        tickets = cursor.fetchall()

        adult_price = "N/A"
        child_price = "N/A"

        for t in tickets:
            if t["type"].lower() == "adult":
                adult_price = str(t["price"])
            elif t["type"].lower() == "child":
                child_price = str(t["price"])

        cursor.close()
        conn.close()

        # Convert time objects to string if they exist
        open_time = str(museum["open_time"]) if museum["open_time"] else "N/A"
        close_time = str(museum["close_time"]) if museum["close_time"] else "N/A"

        # ---- FINAL JSON RESPONSE ----
        return jsonify({
            "name": museum["name"],
            "description": museum["description"],
            "open_time": open_time,
            "close_time": close_time,
            "adult_price": adult_price,
            "child_price": child_price,
            "highlights": museum.get("description", "")[:200],  # First 200 chars as highlights
            "location": museum.get("address", "N/A"),
            "city": museum.get("city", "N/A"),
            "category": museum.get("category", "N/A")
        })
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# 3️⃣ Get museum gallery images
@app.route("/get_museum_gallery/<int:museum_id>")
def get_museum_gallery(museum_id):
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, image_url FROM gallery WHERE museum_id = %s
        """, (museum_id,))
        images = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(images)
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# 4️⃣ Get museums by city
@app.route("/get_museums_by_city/<city>")
def get_museums_by_city(city):
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, name, description, main_image, city, category
            FROM museums 
            WHERE city = %s
            ORDER BY id
        """, (city,))
        museums = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(museums)
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# 5️⃣ Get museums by category
@app.route("/get_museums_by_category/<category>")
def get_museums_by_category(category):
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, name, description, main_image, city, category
            FROM museums 
            WHERE category = %s
            ORDER BY id
        """, (category,))
        museums = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(museums)
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# 6️⃣ Search museums
@app.route("/search_museums")
def search_museums():
    query = request.args.get('q', '')
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, name, description, main_image, city, category
            FROM museums 
            WHERE name ILIKE %s OR description ILIKE %s OR city ILIKE %s
            ORDER BY id
            LIMIT 20
        """, (f'%{query}%', f'%{query}%', f'%{query}%'))
        museums = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(museums)
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# 7️⃣ Get all unique cities
@app.route("/get_cities")
def get_cities():
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT DISTINCT city FROM museums ORDER BY city")
        cities = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify([c['city'] for c in cities])
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# 8️⃣ Get all unique categories
@app.route("/get_categories")
def get_categories():
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT DISTINCT category FROM museums ORDER BY category")
        categories = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify([c['category'] for c in categories])
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

# ---------- HEALTH CHECK ----------
@app.route("/health")
def health():
    conn = get_db_connection()
    if not conn:
        return jsonify({"status": "error", "message": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        conn.close()
        return jsonify({"status": "healthy", "database": "connected"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ---------- RUN ----------
if __name__ == "__main__":
    port = int(os.getenv('PORT', 5001))
    app.run(debug=True, host='0.0.0.0', port=port)
