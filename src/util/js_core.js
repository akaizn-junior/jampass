function useElementFactory(selector, scope) {
    let sel = selector || '';
    let all = document.querySelectorAll(`[data-scope=\"${scope}\"] ${sel}`);

    const handler = (cb) => {
        let _cb = cb !== void 0 && typeof cb === "function" ? cb : function() {};
        for (let i = 0; i < all.length; i++) {
            let el = all[i];
            _cb(el)
        }
    }

    return handler
}
