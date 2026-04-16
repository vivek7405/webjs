;; extends

; html`...` tagged template → inject HTML highlighting
(call_expression
  function: (identifier) @_tag
  (#eq? @_tag "html")
  arguments: ((template_string) @injection.content
    (#offset! @injection.content 0 1 0 -1)
    (#set! injection.include-children)
    (#set! injection.language "html")))

; css`...` tagged template → inject CSS highlighting
(call_expression
  function: (identifier) @_tag
  (#eq? @_tag "css")
  arguments: ((template_string) @injection.content
    (#offset! @injection.content 0 1 0 -1)
    (#set! injection.include-children)
    (#set! injection.language "css")))
