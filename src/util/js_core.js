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

/**
 * Evaluates code and writes the result as replacement for the selector's content
 */
 function staticUpdate(scope) {
    return selector => cb => {
        let all = queryByScope(selector, scope);
        all(elem => {
            let _cb = safeFun(cb);
            let content = elem.innerHTML;

            let codeToEval = `var ev = ${_cb}; ev('${content}');`;
            let staticResult = eval(codeToEval);
            // return staticResult;
            elem.innerHTML = staticResult;
        });
    }
}
