/**
 * /api/shifts — canonical "shift" alias for /api/cash-sessions.
 * Same handlers, one implementation; both paths stay valid.
 */
export { GET } from '../cash-sessions/route';
