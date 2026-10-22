const stub = new Proxy(function () {}, { get: (t, p) => (p === '__esModule' ? false : stub), apply: () => stub, construct: () => stub });
