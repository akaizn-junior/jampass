const _x_SafeFun = f => typeof f === "function" ? f : function() {};

class _x_Element  {
    constructor(nodeList, nodeIndex) {
        this._nodeList = nodeList;
        this._nodeIndex = nodeIndex - 1;
        this._element = nodeList[this._nodeIndex] || nodeList[0]
    }

    get element() {
        return this._element;
    }

    // Allows for specific access to an instance
    get(index) {
        return this._nodeList[index];
    }
}

/**
 * Query a component by its scope
 */
function _x_QueryByScope(selector, scope, instance) {
    let sel = typeof selector === "string" ? selector : '';
    let _instance = typeof instance === "number" ? instance : 0;

    // query a component by its class selector
    let scoped_selector = `.${sel}_x_${scope}`;
    let all = document.querySelectorAll(scoped_selector) || [];

    let _x_elem = new _x_Element(all, _instance);
    // hopefully future proof
    // it allows to compose any other method that its not the element into one
    let accessors = {
        get: _x_elem.get.bind(_x_elem)
    }

    // return a list,  design wise,
    // it allows the user to deconstruct with named vars without aliasing like one would with an object
    // so the user would get something like [h1, accessors] or just [h1]
    return [_x_elem.element, accessors];
}
