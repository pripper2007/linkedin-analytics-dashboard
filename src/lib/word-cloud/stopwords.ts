// Combined Portuguese + English stopword list for the word-cloud feature.
//
// Keep this list conservative: we'd rather see a marginal noise word in the
// cloud than drop a meaningful domain term. Lists below were trimmed from
// the standard snowball stopword corpora, then augmented with a small set
// of filler words common in LinkedIn posts (e.g. "hoje", "today", "great").

const PT = [
  // Articles, pronouns, conjunctions, prepositions
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas',
  'em', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'com', 'sem', 'sob', 'sobre',
  'e', 'ou', 'mas', 'que', 'se', 'como', 'quando', 'porque', 'porquê', 'porem', 'porém',
  'eu', 'tu', 'ele', 'ela', 'nós', 'vós', 'eles', 'elas',
  'me', 'te', 'se', 'lhe', 'lhes', 'nos', 'vos',
  'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'nosso', 'nossa', 'nossos', 'nossas',
  'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas', 'isso', 'isto', 'aquilo',
  'aqui', 'ali', 'lá', 'ai', 'além', 'alem',
  // Common verbs & auxiliaries (infinitive + frequent conjugations)
  'ser', 'estar', 'ter', 'haver', 'fazer', 'ir', 'vir', 'dar',
  'é', 'são', 'foi', 'fui', 'era', 'sou', 'seja',
  'está', 'estão', 'estava', 'estou', 'estive',
  'tem', 'têm', 'tinha', 'tive', 'temos',
  'há', 'havia', 'houve',
  'faz', 'fiz', 'fez', 'faço', 'fazem',
  // Conversational fillers + connectives the user called out
  'muito', 'mais', 'menos', 'também', 'tambem', 'já', 'ainda', 'só', 'apenas', 'bem',
  'hoje', 'ontem', 'amanhã', 'agora', 'então', 'entao',
  'sim', 'não', 'nao', 'talvez',
  'algo', 'todo', 'toda', 'todos', 'todas', 'cada', 'qualquer',
  'pode', 'podem', 'poder', 'deve', 'devem', 'precisa', 'precisam',
  'vai', 'vão', 'vou',
  // Newly added connectives / fillers (2026-04-18 user feedback)
  'até', 'ate', 'quase', 'enquanto', 'onde', 'antes', 'depois', 'logo',
  'tanto', 'tantos', 'tanta', 'tantas', 'através', 'atraves',
  'contra', 'entre', 'durante', 'conforme', 'segundo', 'exceto',
  'dentro', 'fora', 'longe', 'perto', 'acima', 'abaixo',
  'porém', 'porem', 'contudo', 'todavia', 'entretanto',
  'além', 'mesmo', 'própria', 'propria', 'próprio', 'proprio',
  'sempre', 'nunca', 'jamais', 'raramente',
  'outro', 'outra', 'outros', 'outras',
  'grande', 'grandes', 'pequeno', 'pequena', 'melhor', 'pior',
  'coisa', 'coisas', 'vez', 'vezes', 'parte', 'partes',
  'todo', 'nada', 'tudo',
  // Round 2 — observed in the Idea Cloud as noise (2026-04-19)
  // Discourse markers / transitional verbs
  'desde', 'confira', 'confiram', 'parece', 'parecem', 'pareça', 'pareçam',
  'acontece', 'acontecem', 'aconteceu', 'deixa', 'deixam', 'deixar',
  'conversa', 'conversas', 'conversar', 'conversando',
  'existe', 'existem', 'existia', 'existiam',
  // Adjectives that are fillers more than ideas
  'próximo', 'próxima', 'próximos', 'próximas', 'proximo', 'proxima', 'proximos', 'proximas',
  'último', 'última', 'últimos', 'últimas', 'ultimo', 'ultima', 'ultimos', 'ultimas',
  'algum', 'alguma', 'alguns', 'algumas',
  'muita', 'muitos', 'muitas',
  'maior', 'maiores', 'menor', 'menores',
  'relevante', 'relevantes',
  'simples', 'simplesmente',
  'completo', 'completa', 'completos', 'completas', 'completamente',
  'primeiro', 'primeira', 'primeiros', 'primeiras',
  'atual', 'atuais', 'atualmente',
  'certo', 'certa', 'certos', 'certas',
  'diferente', 'diferentes',
  // Time / magnitude references
  'crescendo', 'crescente', 'crescentes',
  'momento', 'momentos', 'tempo', 'tempos',
  'semana', 'semanas', 'mês', 'meses', 'ano', 'anos', 'dia', 'dias',
  'hora', 'horas', 'minuto', 'minutos',
  'milhão', 'milhões', 'milhao', 'milhoes', 'bilhão', 'bilhões', 'bilhao', 'bilhoes',
  'mil', 'milhares',
  // Generic nouns that show up as filler ("este artigo", "essas pessoas")
  'pessoa', 'pessoas', 'gente',
  'visão', 'visões', 'visao', 'visoes',
  'artigo', 'artigos', 'post', 'posts', 'texto', 'textos',
  'entrada', 'entradas', 'saída', 'saídas', 'saida', 'saidas',
  'número', 'números', 'numero', 'numeros',
  'dois', 'duas', 'três', 'tres', 'quatro', 'cinco',
  'foco', 'focos',
  'cópia', 'copia', 'copias', 'cópias',
  'cola',
  'padrão', 'padrões', 'padrao', 'padroes',
  'prática', 'pratica', 'práticas', 'praticas',
  'lógica', 'logica', 'lógicas', 'logicas',
  'caso', 'casos',
  'forma', 'formas', 'modo', 'modos',
  // Round 3 — observed as filler in the cloud (2026-05-02 user feedback):
  // generic verbs / nouns / body parts that don't carry a topic.
  'manter', 'mantém', 'mantem', 'mantendo', 'mantida', 'mantido',
  'final', 'finais', 'finalmente',
  'memória', 'memoria', 'memórias', 'memorias',
  'mão', 'mao', 'mãos', 'maos',
  'cabeça', 'cabeca', 'olho', 'olhos', 'pé', 'pe', 'pés', 'pes',
  'lado', 'lados', 'fim', 'início', 'inicio',
  'ponto', 'pontos', 'nível', 'nivel', 'níveis', 'niveis',
  'ideia', 'ideias', 'opinião', 'opiniao', 'opiniões', 'opinioes',
  'falar', 'falando', 'falou', 'falei', 'fala', 'dizer', 'dizendo', 'disse', 'digo',
  'usar', 'usando', 'usado', 'usada', 'uso',
  'ver', 'vendo', 'visto', 'vista', 'vê', 've', 'vejo',
  'saber', 'sabendo', 'sabe', 'sabia', 'sei',
  'achar', 'acho', 'acha', 'achou', 'achei',
  'dar', 'dando', 'deu', 'dei', 'dou', 'dá', 'da',
];

const EN = [
  // Articles, pronouns, conjunctions, prepositions
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'so',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
  'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs',
  'this', 'that', 'these', 'those', 'here', 'there',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'without', 'about',
  'from', 'as', 'into', 'onto', 'over', 'under', 'through', 'between',
  // Common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'have', 'has', 'had', 'do', 'does', 'did', 'doing',
  'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
  'get', 'got', 'make', 'made', 'go', 'went', 'going', 'come', 'came',
  // Fillers
  'not', 'no', 'yes', 'very', 'more', 'most', 'less', 'least', 'also', 'just',
  'today', 'yesterday', 'tomorrow', 'now', 'then', 'when', 'where', 'why', 'how',
  'what', 'which', 'who', 'whom',
  'some', 'any', 'all', 'each', 'every', 'other', 'another',
  'one', 'two', 'three', 'first', 'second', 'third',
  'like', 'great', 'good', 'bad', 'new', 'old', 'really', 'well',
  // Additional connectives / fillers
  'until', 'almost', 'though', 'although', 'whereas', 'while',
  'before', 'after', 'during', 'against', 'among', 'within',
  'outside', 'inside', 'above', 'below', 'over', 'under',
  'always', 'never', 'ever', 'often', 'rarely', 'sometimes',
  'however', 'therefore', 'thus', 'hence', 'meanwhile',
  'thing', 'things', 'stuff', 'way', 'ways', 'time', 'times',
  'lot', 'lots', 'much', 'many', 'few', 'several',
  'everyone', 'anyone', 'someone', 'nobody', 'everybody', 'somebody',
  'everything', 'anything', 'something', 'nothing',
];

// Set for O(1) lookup during tokenization.
export const STOPWORDS: ReadonlySet<string> = new Set([...PT, ...EN]);
