export const config = {
  runtime: 'edge',
};

export default function handler() {
  return new Response('pong v2 - with GTM pipeline');
}
