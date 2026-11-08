// Vercel function entry: /generate, /evaluate, /validate are rewritten to /api/generator?op=<op> (vercel.json).
import { handle } from "./handler.js";
const op = (request: Request) => new URL(request.url).searchParams.get("op") ?? "";
export function POST(request: Request): Promise<Response> { return handle(request, op(request)); }
export function GET(request: Request): Promise<Response> { return handle(request, op(request)); }
