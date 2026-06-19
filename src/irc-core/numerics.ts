export const NUMERICS: Record<string, string> = {
  RPL_WELCOME: '001',
  RPL_YOURHOST: '002',
  RPL_CREATED: '003',
  RPL_MYINFO: '004',
  RPL_ISUPPORT: '005',
  RPL_WHOISUSER: '311',
  RPL_ENDOFWHOIS: '318',
  RPL_WHOISCHANNELS: '319',
  RPL_WHOISBOT: '335',
  RPL_WHOSPCRPL: '354',
  RPL_NAMREPLY: '353',
  RPL_ENDOFNAMES: '366',
  ERR_INPUTTOOLONG: '417',
  RPL_WHOISACCOUNT: '330',
  RPL_MONONLINE: '730',
  RPL_MONOFFLINE: '731',
  RPL_LOGGEDIN: '900',
  RPL_LOGGEDOUT: '901',
  ERR_NICKLOCKED: '902',
  RPL_SASLSUCCESS: '903',
  ERR_SASLFAIL: '904',
  ERR_SASLTOOLONG: '905',
  ERR_SASLABORTED: '906',
  ERR_SASLALREADY: '907',
  RPL_SASLMECHS: '908',
};

const REVERSE = Object.fromEntries(Object.entries(NUMERICS).map(([k, v]) => [v, k]));

export function numericName(code: string): string | undefined {
  return REVERSE[code];
}
