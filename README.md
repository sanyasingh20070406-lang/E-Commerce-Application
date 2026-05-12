# E-Commerce FastAPI Setup

This project uses a static frontend with a FastAPI backend and SQLite database.

## Features

- User registration and login
- Token-based session handling
- Persistent cart storage per user
- Order creation on checkout
- SQLite database with automatic setup

## Backend Stack

- Python
- FastAPI
- SQLite
- Pydantic
- Uvicorn

## Run It

1. Install dependencies:

```bash
python -m pip install -r requirements.txt
```

2. Set up OTP email:

Create a `.env` file in the project root using `.env.example` as a guide:

```text
SMTP_EMAIL=yourgmail@gmail.com
SMTP_APP_PASSWORD=your_16_character_gmail_app_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
FASTAPI_PORT=8001
```

For Gmail, enable 2-Step Verification on your Google account and create an App Password. Put that app password in `SMTP_APP_PASSWORD`; do not use your normal Gmail password.

3. Start the API server:

```bash
python app.py
```

4. Open the site from FastAPI in the browser:

```text
http://127.0.0.1:8001/
```

You can also use:

```text
http://127.0.0.1:8001/shop.html
```

```text
http://127.0.0.1:8001/index.html
```
The frontend and API now both run from `http://127.0.0.1:8001`.

## API Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/cart`
- `POST /api/cart`
- `PUT /api/cart/{product_id}`
- `DELETE /api/cart/{product_id}`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/health`

## Database

The backend creates `ecommerce.db` automatically in the project root.

## Notes

- Auth state is stored in `localStorage` as `authToken` and `currentUser`.
- Cart data is synced from FastAPI after login and during checkout.
- Open the pages with `http://127.0.0.1:8001/...`, not `file:///...`.
- If the frontend shows a connection error, make sure the FastAPI server is running on port `8001`.
