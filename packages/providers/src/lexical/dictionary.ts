/**
 * Compact dictionary of common Portuguese and English terms with commercial relevance.
 * Used only to detect "confidently recognizable" tokens; absence of a match is not evidence
 * of low quality. Keep entries lowercase ASCII (accents are not present in domain labels).
 */
const WORDS = `
academia acao acai advogado advogados agencia agro agua ajuda alimento alimentos aluguel amor animal animais apartamento app apps
arte artes arquitetura assistencia auto autos aventura bairro banco bar barato bebe beleza bem bicicleta bike bio blog bolsa bom bonito brasil brasileiro
brinquedo brinquedos buffet cabelo cafe caixa calcado calcados cama camisa campo cantina capital carro carros casa casas celular centro cerveja
chef chave cidade cinema classe clinica clube cobertura coco colegio comercio comida compra compras conexao consultoria conta contabil contabilidade
construcao consulta cozinha credito cultura curso cursos dados delivery dental dentista design designer dieta digital dinheiro direito doce doces
doutor educacao eletro eletronica empresa empresas energia engenharia ensino escola escritorio espaco esporte esportes estetica estilo estudio evento
eventos expresso fabrica facil familia farmacia fashion fazenda feira festa festas filme fisio fit fitness flor flores foco foto fotos futebol
galeria game games garagem gastronomia gente gestao global gourmet grafica grande grupo guia hoje hotel ideia ideias igreja imobiliaria imoveis
imovel industria info informatica inova inovacao instituto investimento jardim jogo jogos jornal juridico lab laboratorio lar lazer legal leve
livro livros loja lojas luz mais mar marca marketing massa medico medicina mega melhor mercado mesa metal minha mobile moda modas moto motos
movel moveis mundo musica nacional natural natureza net nova novo nutri nutricao obra obras oficina online otica padaria pagamento pao papel
parque pedra pele pet pets pizza pizzaria planeta plano plus ponto portal pousada praia premium pro produto produtos projeto projetos promocao
psicologo quarto quimica radio rapido receita rede reforma remedio restaurante rio roupa roupas rural saude seguro seguros servico servicos shop
shopping site sites social sol solar solucoes som sorvete studio sul super tech tecnologia telefone tempo terra tour transporte trabalho
turismo uniforme universidade urbano vale veiculo veiculos venda vendas verde vestido viagem viagens vida video vidro vinho vip virtual visao web
zona
about air app art auto baby bank bar beauty best big bike bio black blog blue body book books box brand build business buy cafe camp
car care cars cash center chat cheap chef city class clean click clinic cloud club code coffee color company connect cook cool craft
creative crypto cyber daily data day deal deals dental design dev digital direct doc doctor dog dogs drive easy eat eco edu energy
estate event express eye fair farm fast film finance fire fit fitness flex flow food foot forum free fresh fun future game games garden
gas gift global go gold golf good green group guide hair happy health help home hosting hot hotel house hub idea info ink insure job
jobs kid kids kitchen lab land law learn legal life light link list live local logic love luxury magic mail map market master max media
medical meet mega metro mind mobile moda money motor movie music my nature net network new news nice now nutri office one online open
order page paper park part pay people pet pets phone photo pixel pizza plan planet play plus point post power premium print pro product
project quick radio real rent repair rest ride rock room safe sale sales school science sea search secure seed sell service services
shop shopping site smart social soft solar solution solutions sound space speed sport sports star start store studio style sun super
support system talk tax team tech tel time tip top total tour toy trade train travel trip true trust tv ultra uni urban vet video view
vip vision voice water way web wed wedding well wine wood work world yoga you zone
`;

export const DICTIONARY: ReadonlySet<string> = new Set(
  WORDS.split(/\s+/).filter((w) => w.length >= 3),
);
