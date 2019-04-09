import { Matcher } from './rewrites';
import { cloudfuncEndpoint, fbhostingEndpoint } from './urls';
import { FirebaseConfig, FetchEvent } from './types';
import { CachedProxy, ServeFunction } from './reverseproxy'

interface ExtraOptions {
    // Extra headers to add to each response
    headers?: HeaderOptions
    // Seed (string) of our cache hash
    // changing the seed will invalidate all previous entries
    seed?: string
}
interface HeaderOptions {
    [key: string]: string | null
}

export default class FirebaseOnCloudflare {
    matcher: Matcher;
    projectID: string;
    hostingEndpoint: URL;
    globalHeaders: HeaderOptions;
    proxy: ServeFunction;
    seed: string;

    constructor(projectID: string, config: FirebaseConfig, extra?: ExtraOptions) {
        // Keep project ID
        this.projectID = projectID;
        // Matcher to map URL paths to cloud funcs
        this.matcher = new Matcher(config.rewrites);
        // Static Hosting endpoint
        this.hostingEndpoint = fbhostingEndpoint(projectID);
        // Custom headers
        this.globalHeaders = (extra && extra.headers) ? extra.headers : {};
        // Cache seed
        this.seed = (extra && extra.seed) ? extra.seed : '42';
        // Proxy
        this.proxy = CachedProxy({
            endpoint: (req: Request) => this.getEndpoint(req),
            headers: () => this.globalHeaders,
            seed: this.seed,
        })
    }

    async serve(event: FetchEvent): Promise<Response> {
        const prom = this.proxy(event)
            .then(
                resp => resp,
                err => new Response(err.stack || err, { status: 500 })
            );

        return event.respondWith(prom);
    }

    getEndpoint(request: Request): URL {
        // Get pathname
        const url = new URL(request.url);
        const pathname = url.pathname;

        // Get cloud func for path
        const funcname = this.matcher.match(pathname);

        // Is this URL part of Firebase's reserved /__/* namespace
        const isReserved = pathname.startsWith('/__/');

        // If no func matched or reserved, pass through to FirebaseHosting
        if (isReserved || !funcname) {
            return this.hostingEndpoint;
        }

        // Route to specific cloud function
        return cloudfuncEndpoint(this.projectID, funcname);
    }
}
