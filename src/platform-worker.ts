import { Hono } from "hono";
import { platformRoutes } from "./platform/index.js";
import type { AppEnv, Bindings } from "./types.js";

/**
 * The reference platform, deployed as its own Worker.
 *
 * It has to be a separate service rather than a route on the tool, because a
 * Worker cannot fetch its own hostname: the tool's JWKS fetch would loop back
 * and fail. That constraint happens to match reality, where the platform and
 * the tool are separate systems run by different people.
 */
const app = new Hono<AppEnv>();
app.get("/health", (c) => c.json({ status: "ok", service: "lti-reference-platform" }));
app.route("/platform", platformRoutes);
app.get("/", (c) => c.redirect("/platform/"));

export default { fetch: app.fetch } satisfies ExportedHandler<Bindings>;
