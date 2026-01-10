#!/bin/bash

# Script de inicialização do serviço de finalização de apostas

echo "=========================================="
echo "  Serviço de Finalização de Apostas"
echo "=========================================="
echo ""

# Verifica se o .env existe
if [ ! -f ".env" ]; then
    echo "⚠️  Arquivo .env não encontrado!"
    echo "Criando a partir do .env.example..."
    cp .env.example .env
    echo "✅ Arquivo .env criado. Por favor, configure as variáveis antes de continuar."
    echo ""
    exit 1
fi

# Verifica se node_modules existe
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
    echo ""
fi

# Verifica se dist existe
if [ ! -d "dist" ]; then
    echo "🔨 Compilando TypeScript..."
    npm run build
    echo ""
fi

echo "🚀 Iniciando serviço..."
echo ""

# Inicia o serviço
npm start
