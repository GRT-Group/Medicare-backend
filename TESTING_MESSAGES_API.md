# Testing the Messages API

This guide details how to interact with the Chat/Messaging API for an organization using tools like Postman or cURL. 

All API requests expect a `Bearer` token in the `Authorization` header.

## Authentication (Getting the Token)
Before making any requests, you need to log in to obtain your JWT token.

- **URL**: `/api/auth/login`
- **Method**: `POST`
- **Headers**:
  - `Content-Type`: `application/json`
- **Body**:
```json
{
  "email": "your_email@example.com",
  "password": "your_password"
}
```
*Note: Copy the `token` from the response and use it as your `<YOUR_JWT_TOKEN>`.*

## 1. Get Chat Messages
Retrieves all messages for the current user's organization.

- **Endpoint**: `/api/messages`
- **Method**: `GET`
- **Headers**:
  - `Authorization`: `Bearer <YOUR_JWT_TOKEN>`
- **Query Parameters**:
  - `otherUserId` (Optional): Filter messages between the current user and this specific user ID.

### Request Example
```bash
curl -X GET "https://api.yourdomain.com/api/messages?otherUserId=1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "organization_id": "1",
      "sender_id": "1",
      "receiver_id": "2",
      "content": "Hello there!",
      "is_edited": false,
      "is_deleted": false,
      "is_read": false,
      "created_at": "2024-01-01T10:00:00.000Z",
      "updated_at": "2024-01-01T10:00:00.000Z",
      "Sender": { "id": "1", "first_name": "John", "last_name": "Doe", "is_online": true },
      "Receiver": { "id": "2", "first_name": "Jane", "last_name": "Smith" }
    }
  ]
}
```

## 2. Send a Message
Creates a new chat message.

- **Endpoint**: `/api/messages`
- **Method**: `POST`
- **Headers**:
  - `Authorization`: `Bearer <YOUR_JWT_TOKEN>`
  - `Content-Type`: `application/json`

### Request Example
```bash
curl -X POST "https://api.yourdomain.com/api/messages" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "receiverId": "2",
    "content": "This is a test message."
  }'
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": "2",
    "organization_id": "1",
    "sender_id": "1",
    "receiver_id": "2",
    "content": "This is a test message.",
    "is_edited": false,
    ...
  }
}
```

## 3. Edit a Message
Updates the content of an existing message. You can only edit your own messages.

- **Endpoint**: `/api/messages/:id` (Replace `:id` with the message ID)
- **Method**: `PUT`
- **Headers**:
  - `Authorization`: `Bearer <YOUR_JWT_TOKEN>`
  - `Content-Type`: `application/json`

### Request Example
```bash
curl -X PUT "https://api.yourdomain.com/api/messages/123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "This is the updated message content."
  }'
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": "2",
    "content": "This is the updated message content.",
    "is_edited": true,
    ...
  }
}
```

## 4. Delete a Message
Soft-deletes a message. You can only delete your own messages.

- **Endpoint**: `/api/messages/:id`
- **Method**: `DELETE`
- **Headers**:
  - `Authorization`: `Bearer <YOUR_JWT_TOKEN>`

### Request Example
```bash
curl -X DELETE "https://api.yourdomain.com/api/messages/123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Message deleted successfully"
}
```

## 5. Update Online Status (Presence Heartbeat)
Updates the current user's `last_active_at` timestamp. The frontend should call this endpoint every 30-60 seconds.

- **Endpoint**: `/api/users/presence`
- **Method**: `POST`
- **Headers**:
  - `Authorization`: `Bearer <YOUR_JWT_TOKEN>`

### Request Example
```bash
curl -X POST "https://api.yourdomain.com/api/users/presence" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Presence updated"
}
```

## 6. Get Online Users
Retrieves a list of users in the organization who are currently online (i.e., have pinged the presence endpoint in the last 2 minutes).

- **URL**: `/api/users/presence`
- **Method**: `GET`
- **Headers**:
  - `Authorization`: `Bearer <YOUR_JWT_TOKEN>`

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "first_name": "John",
      "last_name": "Doe",
      "last_active_at": "2024-01-01T10:05:00.000Z",
      "role": {
        "name": "Admin"
      }
    }
  ]
}
```
