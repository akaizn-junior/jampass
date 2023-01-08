const _x_SafeFun = f => typeof f === "function" ? f : function() {};

class _x_Element  {
    constructor(selector, nodeList) {
        this._selector = selector;
        this._nodeList = nodeList;
        this._prop = null;
    }

    get(prop) {
        // the index here should be statically replaced for each component
        return this._nodeList[0][prop];
    }

    prop(name) {
        this._prop = name;
        return {
            edit: this._edit,
            append: this._append
        }
    }

    addEventListener(type, listener, options_useCapture = false) {
        for (let i = 0; i < this._nodeList.length; i++) {
            let _listener = _x_SafeFun(listener);
            // either an options object or the useCapture boolean
            let _options_useCapture = options_useCapture || false;
            this._nodeList[i].addEventListener(type, _listener, _options_useCapture);
        }
    }

    _edit(value) {
        this.prop && this._apply(this._prop, value, 'edit');
    }

    _append(value) {
        this.prop && this._apply(this._prop, value, 'append');
    }

    _apply(prop, value, op = 'edit') {
        for (let i = 0; i < this._nodeList.length; i++) {
            let isProp = this._nodeList[i][prop] !== void 0;

            if (!isProp) {
                console.error(`Invalid property: "${prop}"`)
                break;
            }

            if (!op || op === 'edit') {
                this._nodeList[i][prop] = value;
            }

            if (op && op === 'append') {
                this._nodeList[i][prop] += value;
            }
        }

        return this;
    }
}

/**
 * Query a component by its scope
 */
function _x_QueryByScope(selector, scope) {
    let sel = typeof selector === "string" ? selector : '';
    let scoped_selector = `._x_${sel}_${scope}`;
    let all = document.querySelectorAll(scoped_selector) || [];
    return new _x_Element(scoped_selector, all);
}
