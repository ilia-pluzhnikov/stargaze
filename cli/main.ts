import { runCli } from './app'

process.exitCode = runCli(process.argv.slice(2), {
  out: (s) => console.log(s),
  err: (s) => console.error(s),
})
