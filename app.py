import hashlib
import os
import secrets
import sqlite3
import smtplib
from contextlib import contextmanager
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
import stripe


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "ecommerce.db")))
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",") if origin.strip()]


def load_env_file() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env_file()

app = FastAPI(title="BuyMore FastAPI Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


class RegisterPayload(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class CartPayload(BaseModel):
    product_id: int
    name: str = Field(min_length=1, max_length=200)
    price: float = Field(ge=0)
    quantity: int = Field(ge=1, le=10)


class CartUpdatePayload(BaseModel):
    quantity: int = Field(ge=0, le=10)


class AddressPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    street: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=100)
    zip: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=1, max_length=100)
    is_default: bool = False


class WishlistPayload(BaseModel):
    product_id: int


class ReviewPayload(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(max_length=1000, default="")


class CheckoutSessionPayload(BaseModel):
    address_id: int
    payment_method: str = Field(default="cod", max_length=30)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_timestamp() -> int:
    return int(datetime.now(timezone.utc).timestamp())


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()




def create_session(connection: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    connection.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user_id, utc_now()),
    )
    return token


def serialize_user(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "email": row["email"]}


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    with get_db() as connection:
        session_row = connection.execute(
            """
            SELECT users.id, users.name, users.email
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (credentials.credentials,),
        ).fetchone()

        if session_row is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        return serialize_user(session_row)


def init_db() -> None:
    with get_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS cart_items (
                user_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, product_id),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                total_amount REAL NOT NULL,
                created_at TEXT NOT NULL,
                payment_status TEXT DEFAULT 'pending',
                payment_method TEXT DEFAULT 'cod',
                address_id INTEGER,
                stripe_session_id TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )
        
        # Handle schema upgrades for orders table
        cursor = connection.execute("PRAGMA table_info(orders)")
        columns = [col["name"] for col in cursor.fetchall()]
        if "payment_status" not in columns:
            connection.execute("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'pending'")
        if "payment_method" not in columns:
            connection.execute("ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'cod'")
        if "address_id" not in columns:
            connection.execute("ALTER TABLE orders ADD COLUMN address_id INTEGER")
        if "stripe_session_id" not in columns:
            connection.execute("ALTER TABLE orders ADD COLUMN stripe_session_id TEXT")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS addresses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                street TEXT NOT NULL,
                city TEXT NOT NULL,
                state TEXT NOT NULL,
                zip TEXT NOT NULL,
                country TEXT NOT NULL,
                is_default BOOLEAN NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS wishlists (
                user_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, product_id),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def healthcheck() -> dict:
    return {"status": "ok", "database": str(DB_PATH)}


@app.post("/api/auth/register")
def register(payload: RegisterPayload) -> dict:
    with get_db() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE email = ?",
            (payload.email.lower(),),
        ).fetchone()
        if existing is not None:
            raise HTTPException(status_code=400, detail="Email is already registered")

        salt = secrets.token_hex(16)
        password_hash = hash_password(payload.password, salt)
        cursor = connection.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.name.strip(), payload.email.lower(), password_hash, salt, utc_now()),
        )
        user_id = cursor.lastrowid
        token = create_session(connection, user_id)
        user_row = connection.execute(
            "SELECT id, name, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    return {"token": token, "user": serialize_user(user_row)}


@app.post("/api/auth/login")
def login(payload: LoginPayload) -> dict:
    with get_db() as connection:
        user_row = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (payload.email.lower(),),
        ).fetchone()
        if user_row is None:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        if hash_password(payload.password, user_row["salt"]) != user_row["password_hash"]:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        token = create_session(connection, user_row["id"])

    return {"token": token, "user": serialize_user(user_row)}


@app.get("/api/cart")
def get_cart(current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        items = connection.execute(
            """
            SELECT product_id, name, price, quantity
            FROM cart_items
            WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (current_user["id"],),
        ).fetchall()

    serialized_items = [
        {
            "product_id": item["product_id"],
            "name": item["name"],
            "price": item["price"],
            "quantity": item["quantity"],
        }
        for item in items
    ]
    return {"items": serialized_items}


@app.post("/api/cart")
def add_cart_item(payload: CartPayload, current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        existing = connection.execute(
            """
            SELECT quantity
            FROM cart_items
            WHERE user_id = ? AND product_id = ?
            """,
            (current_user["id"], payload.product_id),
        ).fetchone()

        new_quantity = payload.quantity
        if existing is not None:
            new_quantity = min(existing["quantity"] + payload.quantity, 10)

        connection.execute(
            """
            INSERT INTO cart_items (user_id, product_id, name, price, quantity, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, product_id)
            DO UPDATE SET
                name = excluded.name,
                price = excluded.price,
                quantity = excluded.quantity,
                updated_at = excluded.updated_at
            """,
            (
                current_user["id"],
                payload.product_id,
                payload.name,
                payload.price,
                new_quantity,
                utc_now(),
            ),
        )

    return {"success": True}


@app.put("/api/cart/{product_id}")
def update_cart_item(
    product_id: int,
    payload: CartUpdatePayload,
    current_user: dict = Depends(get_current_user),
) -> dict:
    with get_db() as connection:
        if payload.quantity == 0:
            connection.execute(
                "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
                (current_user["id"], product_id),
            )
        else:
            updated = connection.execute(
                """
                UPDATE cart_items
                SET quantity = ?, updated_at = ?
                WHERE user_id = ? AND product_id = ?
                """,
                (payload.quantity, utc_now(), current_user["id"], product_id),
            )
            if updated.rowcount == 0:
                raise HTTPException(status_code=404, detail="Cart item not found")

    return {"success": True}


@app.delete("/api/cart/{product_id}")
def delete_cart_item(product_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        connection.execute(
            "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
            (current_user["id"], product_id),
        )
    return {"success": True}


@app.post("/api/checkout/create-session")
def create_checkout_session(payload: CheckoutSessionPayload, request: Request, current_user: dict = Depends(get_current_user)) -> dict:
    allowed_payment_methods = {"cod", "card", "upi"}
    if payload.payment_method not in allowed_payment_methods:
        raise HTTPException(status_code=400, detail="Invalid payment method selected")

    with get_db() as connection:
        items = connection.execute(
            "SELECT product_id, name, price, quantity FROM cart_items WHERE user_id = ?",
            (current_user["id"],),
        ).fetchall()

        if not items:
            raise HTTPException(status_code=400, detail="Your cart is empty")

        total_amount = sum(item["price"] * item["quantity"] for item in items)
        
        address = connection.execute("SELECT id FROM addresses WHERE id = ? AND user_id = ?", (payload.address_id, current_user["id"])).fetchone()
        if not address:
            raise HTTPException(status_code=400, detail="Invalid address selected")

        # Generate a unique session ID for Stripe simulation
        session_id = f"sim_sess_{secrets.token_hex(8)}"
        
        cursor = connection.execute(
            """
            INSERT INTO orders (user_id, total_amount, created_at, payment_status, payment_method, address_id, stripe_session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (current_user["id"], total_amount, utc_now(), 'pending', payload.payment_method, payload.address_id, session_id),
        )
        order_id = cursor.lastrowid

        for item in items:
            connection.execute(
                """
                INSERT INTO order_items (order_id, product_id, name, price, quantity)
                VALUES (?, ?, ?, ?, ?)
                """,
                (order_id, item["product_id"], item["name"], item["price"], item["quantity"]),
            )

        # Stripe is simulated here for demo purposes since we don't have API keys
        base_url = str(request.base_url).rstrip("/")
        checkout_url = f"{base_url}/api/checkout/simulate-success?session_id={session_id}"
        
        return {"checkout_url": checkout_url}


@app.get("/api/checkout/simulate-success", include_in_schema=False)
def simulate_payment_success(session_id: str) -> RedirectResponse:
    with get_db() as connection:
        order = connection.execute("SELECT id, user_id FROM orders WHERE stripe_session_id = ?", (session_id,)).fetchone()
        if order:
            connection.execute("UPDATE orders SET payment_status = 'paid' WHERE id = ?", (order["id"],))
            connection.execute("DELETE FROM cart_items WHERE user_id = ?", (order["user_id"],))
    return RedirectResponse(url="/success.html", status_code=302)


@app.get("/api/orders")
def get_orders(current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        orders = connection.execute(
            """
            SELECT id, total_amount, created_at, payment_status, payment_method
            FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (current_user["id"],),
        ).fetchall()

    return {
        "orders": [
            {
                "id": order["id"],
                "total_amount": order["total_amount"],
                "created_at": order["created_at"],
                "payment_status": order["payment_status"],
                "payment_method": order["payment_method"],
            }
            for order in orders
        ]
    }


@app.get("/api/addresses")
def get_addresses(current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        rows = connection.execute(
            "SELECT id, name, street, city, state, zip, country, is_default FROM addresses WHERE user_id = ?",
            (current_user["id"],),
        ).fetchall()
    return {"addresses": [dict(row) for row in rows]}


@app.post("/api/addresses")
def add_address(payload: AddressPayload, current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        if payload.is_default:
            connection.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ?", (current_user["id"],))
        
        cursor = connection.execute(
            """
            INSERT INTO addresses (user_id, name, street, city, state, zip, country, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (current_user["id"], payload.name, payload.street, payload.city, payload.state, payload.zip, payload.country, payload.is_default)
        )
    return {"id": cursor.lastrowid, "success": True}


@app.delete("/api/addresses/{address_id}")
def delete_address(address_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        connection.execute("DELETE FROM addresses WHERE id = ? AND user_id = ?", (address_id, current_user["id"]))
    return {"success": True}


@app.get("/api/wishlist")
def get_wishlist(current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        rows = connection.execute("SELECT product_id FROM wishlists WHERE user_id = ?", (current_user["id"],)).fetchall()
    return {"items": [row["product_id"] for row in rows]}


@app.post("/api/wishlist")
def add_to_wishlist(payload: WishlistPayload, current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        connection.execute(
            "INSERT OR IGNORE INTO wishlists (user_id, product_id, created_at) VALUES (?, ?, ?)",
            (current_user["id"], payload.product_id, utc_now())
        )
    return {"success": True}


@app.delete("/api/wishlist/{product_id}")
def remove_from_wishlist(product_id: int, current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        connection.execute("DELETE FROM wishlists WHERE user_id = ? AND product_id = ?", (current_user["id"], product_id))
    return {"success": True}


@app.get("/api/products/{product_id}/reviews")
def get_reviews(product_id: int) -> dict:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT r.id, r.rating, r.comment, r.created_at, u.name as user_name
            FROM reviews r
            JOIN users u ON u.id = r.user_id
            WHERE r.product_id = ?
            ORDER BY r.created_at DESC
            """,
            (product_id,),
        ).fetchall()
    return {"reviews": [dict(row) for row in rows]}


@app.post("/api/products/{product_id}/reviews")
def add_review(product_id: int, payload: ReviewPayload, current_user: dict = Depends(get_current_user)) -> dict:
    with get_db() as connection:
        connection.execute(
            """
            INSERT INTO reviews (user_id, product_id, rating, comment, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (current_user["id"], product_id, payload.rating, payload.comment, utc_now())
        )
    return {"success": True}


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/shop.html", status_code=302)


app.mount("/", StaticFiles(directory=BASE_DIR, html=True, check_dir=True), name="frontend")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.getenv("FASTAPI_HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", os.getenv("FASTAPI_PORT", "8000"))),
        reload=False,
    )
