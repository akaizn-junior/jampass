- Static Components of the flavour of Web Components
    - You may defined a template as you would a web component with a few new detailts
    - You may have a style and script tag inside your template for style and functionality
    - You may have nested components
    - Components are linked via the link tag with the rel attribute defined as "component"
    - You may have declare components inside your HTML
    - Component must have a valid id. A valid id starts with the "x-" prefix and that's it. An id is applied on the template tag and the link if linked
    - You may use static components just like you would web components. e.x: `<x-your-tag />`
    - You may pass props and use them in your components via the data-attributes attribute in the template
    - Props are used as such: --prop in the css, just like a custom css property, and ("prop") or ('prop') everywhere else, aka HTML and JS
    - Components may be fragments with the data-fragment attribute
    - and much more...

- Provides different strategies for reading the project
    - may identify the project from an index.html or index.htm file, from the root folder
    - may identify the project from a folder named src, the src name can be changed
    - all in the order described above, index.html/index.htm or src folder

- Components are defined as HTML files with a template tag
- Components can be used in HTML multiple times, they are identified by their usage count aka instance
- Static JS functions that generate a more comprehensive toolset to manage multiple instances of the same static component
- You may pass children to the component via the slots just like in Web components, except the slot tag is completely replaced not filled

