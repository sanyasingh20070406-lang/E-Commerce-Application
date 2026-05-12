import sqlite3
from pathlib import Path

DB_PATH = Path("ecommerce.db")

def check_db():
    if not DB_PATH.exists():
        print("Database file not found.")
        return

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    cursor = connection.cursor()

    try:
        print("--- Users ---")
        users = cursor.execute("SELECT id, name, email FROM users").fetchall()
        for u in users:
            print(dict(u))

        print("\n--- Sessions ---")
        sessions = cursor.execute("SELECT * FROM sessions").fetchall()
        for s in sessions:
            print(dict(s))

        print("\n--- Cart Items ---")
        cart = cursor.execute("SELECT * FROM cart_items").fetchall()
        for c in cart:
            print(dict(c))

    except Exception as e:
        print(f"Error: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    check_db()
