# SyncPay API Documentation Reference

Official documentation reference compiled from https://syncpay.apidog.io/ for integration.

---

## 1. Authentication (Token Retrieval)

Retrieve a temporary JWT access token (~1 hour lifetime).

* **Method:** `POST`
* **Path:** `/api/partner/v1/auth-token`
* **Content-Type:** `application/json`

### Request Body
```json
{
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET"
}
```

### Success Response (200 OK)
```json
{
  "access_token": "JWT_TOKEN_HERE",
  "token_type": "bearer",
  "expires_in": 3600
}
```

---

## 2. Cash-In (Create PIX Charge)

Create a Pix transaction for cash-in.

* **Method:** `POST`
* **Path:** `/api/partner/v1/cash-in`
* **Headers:**
  * `Authorization: Bearer <access_token>`
  * `Content-Type: application/json`

### Request Body
```json
{
  "amount": 10.50,
  "description": "Venda Teste",
  "webhook_url": "https://yourdomain.com/api/webhooks/syncpay?token=SECRET",
  "client": {
    "name": "Nome do Cliente",
    "cpf": "12345678901",
    "email": "cliente@email.com",
    "phone": "11999999999"
  }
}
```
*Note: `client.cpf` must be 11 numeric digits (`/^\d{11}$/`), and `client.phone` must be 10 or 11 numeric digits (`/^\d{10,11}$/`).*

### Success Response (201 Created)
```json
{
  "message": "Cashin request successfully submitted",
  "pix_code": "000201010212261040014br.gov.bcb.pix...",
  "identifier": "formato-uuid-da-transacao"
}
```

---

## 3. Webhook (Payment Notification)

Sent by SyncPay when a transaction status is updated.

* **Method:** `POST`
* **Headers:**
  * `Authorization: Bearer {optional_token}`

### Request Body (JSON)
```json
{
  "data": {
    "id": "formato-uuid-da-transacao",
    "client": {
      "name": "Nome do Cliente",
      "email": "cliente@email.com",
      "document": "12345678901"
    },
    "pix_code": "0002010102...",
    "amount": 10.50,
    "final_amount": 10.50,
    "currency": "BRL",
    "status": "completed",
    "payment_method": "pix",
    "created_at": "2026-07-14T20:19:27Z",
    "updated_at": "2026-07-14T20:19:30Z"
  }
}
```
*Note: Status values include: `pending`, `completed`, `failed`, `refunded`, `med` (chargeback).*

---

## 4. Balance check

Retrieve available partner balance.

* **Method:** `GET`
* **Path:** `/api/partner/v1/balance`
* **Headers:**
  * `Authorization: Bearer <access_token>`

### Success Response (200 OK)
```json
{
  "balance": 1500.75
}
```
