const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

const db = new sqlite3.Database('/tmp/db.sqlite', (err) => {
  if (err) console.error('Erro ao conectar ao banco de dados:', err.message);
  else {
    console.log('Conectado ao banco de dados SQLite.');
    setTimeout(() => {
      initializeDatabase();
    }, 100);
  }
});

function initializeDatabase() {
  // Tabela de pedidos
  db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      acao TEXT,
      usuario TEXT,
      data TEXT
    )
  `);

  // Tabela de pagamentos
  db.run(`
    CREATE TABLE IF NOT EXISTS pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER,
      data TEXT,
      valor REAL,
      metodo TEXT,
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
    )
  `);
}

// Login do admin
app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'norteletricaadmin@gmail.com' && password === 'norteletrica2025') {
    db.run('INSERT INTO logs (acao, usuario, data) VALUES (?, ?, ?)', ['Login Admin', email, new Date().toISOString()], (err) => {
      if (err) console.error('Erro ao registrar log:', err.message);
    });
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Credenciais inválidas' });
  }
});

// Login do cliente
app.post('/cliente/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM usuarios WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    if (!row || !bcrypt.compareSync(password, row.senha)) {
      return res.json({ success: false, message: 'Credenciais inválidas' });
    }
    db.run('INSERT INTO logs (acao, usuario, data) VALUES (?, ?, ?)', ['Login Cliente', email, new Date().toISOString()], (err) => {
      if (err) console.error('Erro ao registrar log:', err.message);
    });
    res.json({ success: true, usuario: email });
  });
});

// Cadastro de cliente
app.post('/cliente/cadastro', (req, res) => {
  const { email, senha, nome, telefone, endereco_padrao, notificar_email } = req.body;
  const hashedPassword = bcrypt.hashSync(senha, 10);
  db.run(
    'INSERT INTO usuarios (email, senha, nome, telefone, endereco_padrao, notificar_email) VALUES (?, ?, ?, ?, ?, ?)',
    [email, hashedPassword, nome, telefone || '', endereco_padrao || '', notificar_email || 1],
    function(err) {
      if (err) return res.status(500).json({ success: false, message: err.message });
      db.run('INSERT INTO logs (acao, usuario, data) VALUES (?, ?, ?)', ['Cadastro Cliente', email, new Date().toISOString()], (err) => {
        if (err) console.error('Erro ao registrar log:', err.message);
      });
      res.json({ success: true, usuario: email });
    }
  );
});

// Atualizar perfil do cliente
app.put('/cliente/perfil', (req, res) => {
  const { email, nome, telefone, endereco_padrao, foto_perfil, notificar_email } = req.body;
  db.run(
    'UPDATE usuarios SET nome = ?, telefone = ?, endereco_padrao = ?, foto_perfil = ?, notificar_email = ? WHERE email = ?',
    [nome, telefone || '', endereco_padrao || '', foto_perfil || '', notificar_email || 1, email],
    function(err) {
      if (err) return res.status(500).json({ success: false, message: err.message });
      db.run('INSERT INTO logs (acao, usuario, data) VALUES (?, ?, ?)', ['Atualização Perfil', email, new Date().toISOString()], (err) => {
        if (err) console.error('Erro ao registrar log:', err.message);
      });
      res.json({ success: true });
    }
  );
});

// Criar novo pedido (admin ou solicitação do cliente)
app.post('/pedidos', (req, res) => {
  const { numero, data, servico, descricao, transporte, entrega, instalacao, manutencao, status, historico, usuario, endereco, metodo_pagamento, valor, comprovante, solicitacao } = req.body;
  db.run(
    `INSERT INTO pedidos (numero, data, servico, descricao, transporte, entrega, instalacao, manutencao, status, historico, usuario, endereco, metodo_pagamento, valor, comprovante, solicitacao) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [numero, data, servico, descricao, transporte || 'A definir', entrega || 'A definir', instalacao || 'A definir', manutencao || 'A definir', status || 'Aguardando Pagamento', historico, usuario, endereco || '', metodo_pagamento || '', valor || 0, comprovante || '', solicitacao || 0],
    function(err) {
      if (err) return res.status(500).json({ success: false, message: err.message });
      db.run('INSERT INTO logs (acao, usuario, data) VALUES (?, ?, ?)', ['Criação Pedido', usuario, new Date().toISOString()], (err) => {
        if (err) console.error('Erro ao registrar log:', err.message);
      });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Atualizar pedido
app.put('/pedidos/:id', (req, res) => {
  const { status, historico, endereco, metodo_pagamento, valor, comprovante } = req.body;
  const id = req.params.id;
  db.run(
    `UPDATE pedidos SET status = ?, historico = ?, endereco = ?, metodo_pagamento = ?, valor = ?, comprovante = ? WHERE id = ?`,
    [status, historico, endereco || '', metodo_pagamento || '', valor || 0, comprovante || '', id],
    function(err) {
      if (err) return res.status(500).json({ success: false, message: err.message });
      if (status === 'Pagamento Confirmado') {
        db.run('INSERT INTO pagamentos (pedido_id, data, valor, metodo) VALUES (?, ?, ?, ?)', [id, new Date().toISOString(), valor, metodo_pagamento], (err) => {
          if (err) console.error('Erro ao registrar pagamento:', err.message);
        });
      }
      db.get('SELECT usuario FROM pedidos WHERE id = ?', [id], (err, row) => {
        if (!err && row) {
          db.run('INSERT INTO logs (acao, usuario, data) VALUES (?, ?, ?)', ['Atualização Pedido', row.usuario, new Date().toISOString()], (err) => {
            if (err) console.error('Erro ao registrar log:', err.message);
          });
        }
      });
      res.json({ success: true });
    }
  );
});

// Excluir pedido
app.delete('/pedidos/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT usuario FROM pedidos WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    db.run('DELETE FROM pedidos WHERE id = ?', [id], function(err) {
      if (err) return res.status(500).json({ success: false, message: err.message });
      if (row) {
        db.run('INSERT INTO logs (acao, usuario, data) VALUES (?, ?, ?)', ['Exclusão Pedido', row.usuario, new Date().toISOString()], (err) => {
          if (err) console.error('Erro ao registrar log:', err.message);
        });
      }
      res.json({ success: true });
    });
  });
});

// Buscar pedidos por usuário (com paginação)
app.get('/pedidos/:usuario', (req, res) => {
  const usuario = req.params.usuario;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  db.all('SELECT * FROM pedidos WHERE usuario = ? LIMIT ? OFFSET ?', [usuario, limit, offset], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    db.get('SELECT COUNT(*) as total FROM pedidos WHERE usuario = ?', [usuario], (err, countRow) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.json({ success: true, pedidos: rows, total: countRow.total, page, limit });
    });
  });
});

// Buscar todos os pedidos (com filtros opcionais)
app.get('/pedidos', (req, res) => {
  const { usuario, status } = req.query;
  let query = 'SELECT * FROM pedidos';
  let params = [];
  if (usuario || status) {
    query += ' WHERE';
    if (usuario) {
      query += ' usuario = ?';
      params.push(usuario);
    }
    if (status) {
      query += usuario ? ' AND status = ?' : ' status = ?';
      params.push(status);
    }
  }
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, pedidos: rows });
  });
});

// Estatísticas
app.get('/stats', (req, res) => {
  db.all('SELECT status, COUNT(*) as count FROM pedidos GROUP BY status', (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    const stats = { total: 0, aguardando: 0, confirmado: 0, transito: 0, concluido: 0 };
    rows.forEach(row => {
      stats.total += row.count;
      if (row.status === 'Aguardando Pagamento') stats.aguardando = row.count;
      if (row.status === 'Pagamento Confirmado') stats.confirmado = row.count;
      if (row.status === 'Em Trânsito') stats.transito = row.count;
      if (row.status === 'Concluído') stats.concluido = row.count;
    });
    res.json({ success: true, stats });
  });
});

// Buscar perfil do cliente
app.get('/cliente/perfil/:email', (req, res) => {
  const email = req.params.email;
  db.get('SELECT email, nome, telefone, endereco_padrao, foto_perfil, notificar_email FROM usuarios WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, perfil: row || {} });
  });
});

// Histórico de pagamentos
app.get('/pagamentos/:usuario', (req, res) => {
  const usuario = req.params.usuario;
  db.all(`
    SELECT p.id, p.data, p.valor, p.metodo, ped.numero 
    FROM pagamentos p 
    JOIN pedidos ped ON p.pedido_id = ped.id 
    WHERE ped.usuario = ?`, [usuario], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, pagamentos: rows });
  });
});

// Adicione esta exportação:
module.exports = app;