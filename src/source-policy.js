// Lista editorial inicial, não uma garantia da veracidade de cada publicação.
// Subdomínios de um mesmo domínio registrável continuam contando como uma origem.
export const defaultTrustedDomains=[
 'gov.br','gov.au','gov.uk','gov','gc.ca','europa.eu','who.int','un.org','fiocruz.br','nasa.gov','esa.int',
 'reuters.com','apnews.com','bbc.com','bbc.co.uk','britannica.com',
 'aosfatos.org','lupa.uol.com.br','boatos.org','fullfact.org',
 'globo.com','uol.com.br','otempo.com.br','poder360.com.br','clicrbs.com.br',
 'cnnbrasil.com.br','sbt.com.br','estadao.com.br','ebc.com.br',
 'rtp.pt','dw.com','abc.net.au','nbcnews.com','cbsnews.com','abcnews.go.com',
 'nytimes.com','washingtonpost.com','theguardian.com','axios.com','france24.com','rfi.fr'
];
export function sourceOrganization(url){
 const host=new URL(url).hostname.toLowerCase();
 if(host==='bbc.com'||host.endsWith('.bbc.com')||host==='bbc.co.uk'||host.endsWith('.bbc.co.uk'))return 'bbc';
 return null;
}
