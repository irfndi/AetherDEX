// Vite `?raw` imports for the D1 migration scripts used by integration tests.
declare module "*.sql?raw" {
  const content: string
  export default content
}
