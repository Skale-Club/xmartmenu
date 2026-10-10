export default function JsonLdScript({ data }: { data: object }) {
  // Escape HTML-significant characters so tenant-controlled strings (business
  // name, product names/descriptions) cannot break out of the <script> element
  // — e.g. a description containing `</script><script>`. Escaping `<` alone
  // defeats the breakout; `>` and `&` are added for defense in depth.
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
