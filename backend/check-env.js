// A simple script to check environment variables

console.log('========== ENVIRONMENT VARIABLE CHECK ==========');
console.log('Checking for API keys:');

const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
const openaiKey = process.env.OPENAI_API_KEY || '';

console.log('ANTHROPIC_API_KEY present:', !!anthropicKey);
if (anthropicKey) {
  const maskedKey = anthropicKey.length > 8 
    ? `${anthropicKey.substring(0, 4)}...${anthropicKey.substring(anthropicKey.length - 4)}`
    : '****';
  console.log('ANTHROPIC_API_KEY format:', maskedKey);
  console.log('ANTHROPIC_API_KEY length:', anthropicKey.length);
}

console.log('OPENAI_API_KEY present:', !!openaiKey);
if (openaiKey) {
  const maskedKey = openaiKey.length > 8 
    ? `${openaiKey.substring(0, 4)}...${openaiKey.substring(openaiKey.length - 4)}`
    : '****';
  console.log('OPENAI_API_KEY format:', maskedKey);
  console.log('OPENAI_API_KEY length:', openaiKey.length);
}

console.log('Other environment variables:');
console.log('MCP_SERVER_BASE_URL:', process.env.MCP_SERVER_BASE_URL);
console.log('NODE_ENV:', process.env.NODE_ENV);

console.log('============================================'); 