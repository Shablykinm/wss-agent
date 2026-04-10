require('dotenv').config({ path: '.env.agent' });
const fs = require('fs');

// ================== Конфигурация ==================
const SERVER_CERT_FILE = process.env.SERVER_CERT_FILE || './certs/server-cert.pem';
const PRIVATE_KEY_FILE = process.env.PRIVATE_KEY_FILE || './certs/id_ed25519.pem';
const PUBLIC_KEY_FILE = process.env.PUBLIC_KEY_FILE || './certs/id_ed25519.pub.pem';
const CONFIG_FILE = process.env.CONFIG_FILE || './data/agent-config.json';
const SERVICES_CONFIG_FILE = process.env.SERVICES_CONFIG_FILE || './data/services-config.json';
const REGISTRATION_TOKEN_FILE = process.env.REGISTRATION_TOKEN_FILE || './data/registration.token';
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY) || 5000;
const TIMEZONE = process.env.TIMEZONE || 'Europe/Moscow';

// ================== Загрузка конфигурации ==================
let agentConfig = { serverId: null, serverIp: null, publicKey: null, registered: false };
if (fs.existsSync(CONFIG_FILE)) {
    agentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} else {
    console.error('❌ Файл конфигурации не найден! Запустите init-agent.sh');
    process.exit(1);
}

// Загрузка конфигурации сервисов
let servicesConfig = {};

function loadServicesConfig() {
    if (fs.existsSync(SERVICES_CONFIG_FILE)) {
        try {
            servicesConfig = JSON.parse(fs.readFileSync(SERVICES_CONFIG_FILE, 'utf8'));
        } catch (e) {
            console.warn('⚠️  Ошибка чтения конфига сервисов, используется пустой конфиг');
            servicesConfig = {};
        }
    }
    return servicesConfig;
}

loadServicesConfig();

const SERVER_ID = agentConfig.serverId;
const SERVER_IP = agentConfig.serverIp;
const REGISTRATION_TOKEN = fs.existsSync(REGISTRATION_TOKEN_FILE) 
    ? fs.readFileSync(REGISTRATION_TOKEN_FILE, 'utf8').trim() 
    : null;

// Загружаем ключи
if (!fs.existsSync(PRIVATE_KEY_FILE) || !fs.existsSync(PUBLIC_KEY_FILE)) {
    console.error('❌ Ключи не найдены! Запустите init-agent.sh');
    process.exit(1);
}

const privateKeyPem = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
const publicKeyPem = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
const publicKeyBase64 = publicKeyPem
    .replace('-----BEGIN PUBLIC KEY-----\n', '')
    .replace('\n-----END PUBLIC KEY-----', '')
    .replace(/\n/g, '');

// Получение текущей даты с учетом часового пояса
function getCurrentDate() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${year}-${month}-${day}`;
}

// Получение вчерашней даты
function getYesterdayDate() {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    
    const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(yesterday);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${year}-${month}-${day}`;
}

// Получение текущего времени с учетом часового пояса
function getCurrentTimestamp() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    return formatter.format(now);
}

// Сохранение конфига агента
function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(agentConfig, null, 2));
}

function getAgentConfig() {
    return agentConfig;
}

function setAgentRegistered(registered) {
    agentConfig.registered = registered;
    saveConfig();
}

module.exports = {
    SERVER_CERT_FILE,
    PRIVATE_KEY_FILE,
    PUBLIC_KEY_FILE,
    CONFIG_FILE,
    SERVICES_CONFIG_FILE,
    REGISTRATION_TOKEN_FILE,
    RECONNECT_DELAY,
    TIMEZONE,
    SERVER_ID,
    SERVER_IP,
    REGISTRATION_TOKEN,
    privateKeyPem,
    publicKeyPem,
    publicKeyBase64,
    saveConfig,
    getAgentConfig,
    setAgentRegistered,
    loadServicesConfig,
    getServicesConfig: () => servicesConfig,
    setServicesConfig: (config) => { servicesConfig = config; },
    getCurrentDate,
    getYesterdayDate,
    getCurrentTimestamp
};