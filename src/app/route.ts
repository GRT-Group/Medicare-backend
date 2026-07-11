export async function GET() {
  return Response.json({
    name: 'Medicare Backend API',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString()
  })
}
