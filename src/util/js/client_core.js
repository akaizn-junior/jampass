const __xSafeFun = f => typeof f === "function" ? f : function() {};

/**
 * Query a component by its scope
 */
function __xQueryByScope(selector, scope) {
    let sel = typeof selector === "string" ? selector : '';
    let all  = document.querySelectorAll(`[data-x-scope=\"${scope}\"]> ${sel}, [data-x-scope=\"${scope}\"]> :not([data-x-nested="true"]) ${sel}`);

    return cb => {
        if (all) {
            for (let i = 0; i < all.length; i++) {
                __xSafeFun(cb)(all[i])
            }
        }
    }
}
