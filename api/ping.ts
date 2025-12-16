export const config = {
  runtime: 'edge',
};

export default function handler() {
  return new Response('pong - Ship or Kill Bot v2.0');
}
