

export let React = null
export let ReactDOM = null

export function setReact(react, reactDom = null) {
  React = react
  if (reactDom) ReactDOM = reactDom
}

export const h = (...args) => React.createElement(...args)
