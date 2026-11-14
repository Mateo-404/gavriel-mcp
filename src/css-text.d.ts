// Bun importa estos archivos como texto (`with { type: 'text' }`)
declare module '*.css' {
  const text: string;
  export default text;
}
