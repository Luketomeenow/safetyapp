import { handle } from "hono/vercel";
import { app } from "../src/app.ts";

export default handle(app);
