const safeFun = f => typeof f === "function" ? f : function() {};

/**
 * Query a component by its scope
 */
function queryByScope(selector, scope) {
    let sel = typeof selector === "string" ? selector : '';
    let all  = document.querySelectorAll(`[data-scope=\"${scope}\"] ${sel}`);

    return cb => {
        if (all) {
            for (let i = 0; i < all.length; i++) {
                safeFun(cb)(all[i])
            }
        }
    }
}
