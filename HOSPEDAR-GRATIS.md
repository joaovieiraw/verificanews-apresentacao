# Publicar VerificaNews gratuitamente no Render

1. Crie um repositório no GitHub e envie o conteúdo deste pacote na raiz. Não envie o ZIP sem extrair. Não envie sua pasta local inteira, `.env`, `.local` ou `node_modules`.
2. Entre em https://dashboard.render.com/ e conecte sua conta GitHub.
3. Escolha New > Blueprint e selecione o repositório. O arquivo render.yaml configura o serviço gratuito.
4. Nos campos GEMINI_API_KEY e TAVILY_API_KEY, insira suas chaves diretamente no painel do Render. Não coloque chaves no GitHub. O segredo de sessão será gerado automaticamente.
5. Confirme o plano Free e publique. Aguarde o serviço ficar Live; abra a URL HTTPS fornecida pelo Render.
6. Teste uma checagem completa nessa URL. Amanhã abra alguns minutos antes da apresentação.

O endereço público é detectado automaticamente. Se configurar domínio próprio, defina APP_ORIGIN com o endereço HTTPS exato, sem caminho.

O histórico é temporário e desaparece ao reiniciar ou suspender o serviço. Após cerca de 15 minutos sem acessos o serviço gratuito dorme; a próxima abertura pode demorar aproximadamente um minuto. A hospedagem e as APIs têm cotas próprias. O link permite que outras pessoas consumam as cotas das suas APIs, sujeito aos limites do aplicativo.

A publicação não altera a lógica de checagem. Guarde a versão Windows como reserva para a apresentação.
