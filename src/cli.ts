/**
 * Command-line entry point. With no subcommand it runs the MCP server over
 * stdio; subcommands manage accounts and credentials. Full dispatch is wired
 * in the CLI milestone; this is the bootstrap.
 */
const VERSION = '0.1.0';

function main(argv: string[]): void {
  const cmd = argv[0];
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`ircv3-mcp ${VERSION}\n`);
    return;
  }
  if (cmd === '--help' || cmd === '-h') {
    process.stderr.write('ircv3-mcp: an IRCv3 MCP server (mini IRC client for agents)\n');
    return;
  }
  process.stderr.write('ircv3-mcp: not yet wired up\n');
}

main(process.argv.slice(2));
