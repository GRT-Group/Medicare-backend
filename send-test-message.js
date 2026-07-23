const jwt = require('jsonwebtoken');
const jwtSecret = 'IHNpSbkyT4kVA0IBmOYmlZtHXgBXNy8Lp0RGfdev5lUxgFa3kwrqOpzpv6E8XHfO';
const token = jwt.sign({ id: '1', role_id: '1', organization_id: '1' }, jwtSecret);
fetch('http://localhost:3000/api/messages', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ receiverId: '2', content: 'Hello from test script!' }) }).then(async r => { const text = await r.text(); console.log('Status:', r.status); console.log('Response:', text); }).catch(console.error);
