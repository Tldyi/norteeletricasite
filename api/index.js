const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors());

// Configuração do pool do PostgreSQL com reconexão
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: {
        rejectUnauthorized: false // Necessário para Neon Postgres
    },
    max: 20, // Máximo de conexões no pool
    idleTimeoutMillis: 30000, // Tempo limite para conexões inativas
    connectionTimeoutMillis: 2000 // Tempo limite para estabelecer uma conexão
});

// Função para garantir uma conexão válida antes de executar uma query
async function getClient() {
    let attempts = 0;
    const maxAttempts = 3;
    const retryInterval = 2000; // 2 segundos entre tentativas

    while (attempts < maxAttempts) {
        try {
            const client = await pool.connect();
            return client;
        } catch (err) {
            attempts++;
            console.error(`Erro ao obter cliente do pool (tentativa ${attempts}/${maxAttempts}):`, err.message);
            if (attempts === maxAttempts) {
                throw new Error('Não foi possível obter uma conexão com o banco de dados após várias tentativas.');
            }
            await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
    }
}

// Lidar com erros de conexão no pool
pool.on('error', (err, client) => {
    console.error('Erro inesperado no pool de conexões:', err.message);
});

// Inicializar o banco de dados
async function initializeDatabase() {
    let client;
    try {
        client = await getClient();
        // Tabela de pedidos
        await client.query(`
            CREATE TABLE IF NOT EXISTS pedidos (
                id SERIAL PRIMARY KEY,
                numero TEXT,
                data TEXT,
                servico TEXT,
                descricao TEXT,
                transporte TEXT,
                entrega TEXT,
                instalacao TEXT,
                manutencao TEXT,
                status TEXT,
                historico TEXT,
                usuario TEXT,
                endereco TEXT,
                metodo_pagamento TEXT,
                valor REAL,
                comprovante TEXT,
                solicitacao INTEGER DEFAULT 0
            )
        `);

        // Tabela de usuários
        await client.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE,
                senha TEXT,
                nome TEXT,
                telefone TEXT,
                endereco_padrao TEXT,
                foto_perfil TEXT,
                notificar_email INTEGER DEFAULT 1
            )
        `);

        // Tabela de logs
        await client.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                acao TEXT,
                usuario TEXT,
                data TEXT
            )
        `);

        // Tabela de pagamentos
        await client.query(`
            CREATE TABLE IF NOT EXISTS pagamentos (
                id SERIAL PRIMARY KEY,
                pedido_id INTEGER,
                data TEXT,
                valor REAL,
                metodo TEXT,
                FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
            )
        `);
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err.message);
    } finally {
        if (client) client.release();
    }
}

// Verificar se POSTGRES_URL está definido corretamente
if (!process.env.POSTGRES_URL) {
    console.error('Erro: POSTGRES_URL não está definido. Configure a variável de ambiente.');
    process.exit(1);
}

console.log('POSTGRES_URL:', process.env.POSTGRES_URL);

// Iniciar a conexão com o banco de dados e inicializar tabelas
(async () => {
    let client;
    try {
        client = await getClient();
        console.log('Conectado ao banco de dados PostgreSQL.');
        await initializeDatabase();
    } catch (err) {
        console.error('Erro ao iniciar a conexão com o banco de dados:', err.message);
        process.exit(1);
    } finally {
        if (client) client.release();
    }
})();

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
    let client;
    try {
        client = await getClient();
        await client.query('SELECT 1');
        res.json({ success: true, message: 'Server is running and connected to the database' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database connection failed', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Login do admin
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    if (email === 'norteletricaadmin@gmail.com' && password === 'norteletrica2025') {
        let client;
        try {
            client = await getClient();
            await client.query('INSERT INTO logs (acao, usuario, data) VALUES ($1, $2, $3)', ['Login Admin', email, new Date().toISOString()]);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Erro ao registrar log', error: err.message });
        } finally {
            if (client) client.release();
        }
    } else {
        res.json({ success: false, message: 'Credenciais inválidas' });
    }
});

// Login do cliente
app.post('/api/cliente/login', async (req, res) => {
    const { email, password } = req.body;
    let client;
    try {
        client = await getClient();
        const result = await client.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        const row = result.rows[0];
        if (!row || !bcrypt.compareSync(password, row.senha)) {
            return res.json({ success: false, message: 'Credenciais inválidas' });
        }
        await client.query('INSERT INTO logs (acao, usuario, data) VALUES ($1, $2, $3)', ['Login Cliente', email, new Date().toISOString()]);
        res.json({ success: true, usuario: email });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao processar login', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Cadastro de cliente
app.post('/api/cliente/cadastro', async (req, res) => {
    const { email, senha, nome, telefone, endereco_padrao, notificar_email } = req.body;
    const hashedPassword = bcrypt.hashSync(senha, 10);
    let client;
    try {
        client = await getClient();
        await client.query(
            'INSERT INTO usuarios (email, senha, nome, telefone, endereco_padrao, notificar_email) VALUES ($1, $2, $3, $4, $5, $6)',
            [email, hashedPassword, nome, telefone || '', endereco_padrao || '', notificar_email || 1]
        );
        await client.query('INSERT INTO logs (acao, usuario, data) VALUES ($1, $2, $3)', ['Cadastro Cliente', email, new Date().toISOString()]);
        res.json({ success: true, usuario: email });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao cadastrar usuário', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Atualizar perfil do cliente
app.put('/api/cliente/perfil', async (req, res) => {
    const { email, nome, telefone, endereco_padrao, foto_perfil, notificar_email } = req.body;
    let client;
    try {
        client = await getClient();
        await client.query(
            'UPDATE usuarios SET nome = $1, telefone = $2, endereco_padrao = $3, foto_perfil = $4, notificar_email = $5 WHERE email = $6',
            [nome, telefone || '', endereco_padrao || '', foto_perfil || '', notificar_email || 1, email]
        );
        await client.query('INSERT INTO logs (acao, usuario, data) VALUES ($1, $2, $3)', ['Atualização Perfil', email, new Date().toISOString()]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao atualizar perfil', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Criar novo pedido (admin ou solicitação do cliente)
app.post('/api/pedidos', async (req, res) => {
    const { numero, data, servico, descricao, transporte, entrega, instalacao, manutencao, status, historico, usuario, endereco, metodo_pagamento, valor, comprovante, solicitacao } = req.body;
    let client;
    try {
        client = await getClient();
        const result = await client.query(
            `INSERT INTO pedidos (numero, data, servico, descricao, transporte, entrega, instalacao, manutencao, status, historico, usuario, endereco, metodo_pagamento, valor, comprovante, solicitacao) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
            [numero, data, servico, descricao, transporte || 'A definir', entrega || 'A definir', instalacao || 'A definir', manutencao || 'A definir', status || 'Aguardando Pagamento', historico, usuario, endereco || '', metodo_pagamento || '', valor || 0, comprovante || '', solicitacao || 0]
        );
        await client.query('INSERT INTO logs (acao, usuario, data) VALUES ($1, $2, $3)', ['Criação Pedido', usuario, new Date().toISOString()]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao criar pedido', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Atualizar pedido
app.put('/api/pedidos/:id', async (req, res) => {
    const { status, historico, endereco, metodo_pagamento, valor, comprovante } = req.body;
    const id = req.params.id;
    let client;
    try {
        client = await getClient();
        await client.query(
            `UPDATE pedidos SET status = $1, historico = $2, endereco = $3, metodo_pagamento = $4, valor = $5, comprovante = $6 WHERE id = $7`,
            [status, historico, endereco || '', metodo_pagamento || '', valor || 0, comprovante || '', id]
        );
        if (status === 'Pagamento Confirmado') {
            await client.query('INSERT INTO pagamentos (pedido_id, data, valor, metodo) VALUES ($1, $2, $3, $4)', [id, new Date().toISOString(), valor, metodo_pagamento]);
        }
        const usuarioResult = await client.query('SELECT usuario FROM pedidos WHERE id = $1', [id]);
        const usuario = usuarioResult.rows[0]?.usuario;
        if (usuario) {
            await client.query('INSERT INTO logs (acao, usuario, data) VALUES ($1, $2, $3)', ['Atualização Pedido', usuario, new Date().toISOString()]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao atualizar pedido', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Excluir pedido
app.delete('/api/pedidos/:id', async (req, res) => {
    const id = req.params.id;
    let client;
    try {
        client = await getClient();
        const usuarioResult = await client.query('SELECT usuario FROM pedidos WHERE id = $1', [id]);
        const usuario = usuarioResult.rows[0]?.usuario;
        await client.query('DELETE FROM pedidos WHERE id = $1', [id]);
        if (usuario) {
            await client.query('INSERT INTO logs (acao, usuario, data) VALUES ($1, $2, $3)', ['Exclusão Pedido', usuario, new Date().toISOString()]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao excluir pedido', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Buscar pedidos por usuário (com paginação)
app.get('/api/pedidos/:usuario', async (req, res) => {
    const usuario = req.params.usuario;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    let client;
    try {
        client = await getClient();
        const pedidosResult = await client.query('SELECT * FROM pedidos WHERE usuario = $1 LIMIT $2 OFFSET $3', [usuario, limit, offset]);
        const countResult = await client.query('SELECT COUNT(*) as total FROM pedidos WHERE usuario = $1', [usuario]);
        res.json({
            success: true,
            pedidos: pedidosResult.rows,
            total: parseInt(countResult.rows[0].total),
            page,
            limit
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao buscar pedidos', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Buscar todos os pedidos (com filtros opcionais)
app.get('/api/pedidos', async (req, res) => {
    const { usuario, status } = req.query;
    let query = 'SELECT * FROM pedidos';
    let params = [];
    if (usuario || status) {
        query += ' WHERE';
        if (usuario) {
            query += ' usuario = $1';
            params.push(usuario);
        }
        if (status) {
            query += usuario ? ' AND status = $2' : ' status = $1';
            params.push(status);
        }
    }
    let client;
    try {
        client = await getClient();
        const result = await client.query(query, params);
        res.json({ success: true, pedidos: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao buscar pedidos', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Estatísticas
app.get('/api/stats', async (req, res) => {
    let client;
    try {
        client = await getClient();
        const result = await client.query('SELECT status, COUNT(*) as count FROM pedidos GROUP BY status');
        const stats = { total: 0, aguardando: 0, confirmado: 0, transito: 0, concluido: 0 };
        result.rows.forEach(row => {
            stats.total += parseInt(row.count);
            if (row.status === 'Aguardando Pagamento') stats.aguardando = parseInt(row.count);
            if (row.status === 'Pagamento Confirmado') stats.confirmado = parseInt(row.count);
            if (row.status === 'Em Trânsito') stats.transito = parseInt(row.count);
            if (row.status === 'Concluído') stats.concluido = parseInt(row.count);
        });
        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Buscar perfil do cliente
app.get('/api/cliente/perfil/:email', async (req, res) => {
    const email = req.params.email;
    let client;
    try {
        client = await getClient();
        const result = await client.query('SELECT email, nome, telefone, endereco_padrao, foto_perfil, notificar_email FROM usuarios WHERE email = $1', [email]);
        res.json({ success: true, perfil: result.rows[0] || {} });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao buscar perfil', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Histórico de pagamentos
app.get('/api/pagamentos/:usuario', async (req, res) => {
    const usuario = req.params.usuario;
    let client;
    try {
        client = await getClient();
        const result = await client.query(`
            SELECT p.id, p.data, p.valor, p.metodo, ped.numero 
            FROM pagamentos p 
            JOIN pedidos ped ON p.pedido_id = ped.id 
            WHERE ped.usuario = $1`, [usuario]);
        res.json({ success: true, pagamentos: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Erro ao buscar pagamentos', error: err.message });
    } finally {
        if (client) client.release();
    }
});

// Middleware para lidar com rotas não encontradas
app.use((req, res, next) => {
    res.status(404).json({ success: false, message: `Rota ${req.url} não encontrada` });
});

// Middleware para lidar com erros gerais
app.use((err, req, res, next) => {
    console.error('Erro no servidor:', err.stack);
    res.status(500).json({ success: false, message: 'Erro interno no servidor', error: err.message });
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});