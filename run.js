const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const matter = require('gray-matter');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DIST_DIR = path.join(__dirname, 'dist');
const POSTS_DIST_DIR = path.join(DIST_DIR, 'posts');
const MD_DIR = path.join(__dirname, 'md');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

/**
 * Step 1: Clean & Initialize
 */
function cleanAndInitialize() {
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(POSTS_DIST_DIR, { recursive: true });
  
  if (!fs.existsSync(MD_DIR)) {
    fs.mkdirSync(MD_DIR);
  }
}

/**
 * Helper: Strip HTML tags and create custom fallback descriptions
 */
function createExcerpt(htmlContent, length) {
  const plainText = htmlContent.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (plainText.length <= length) return plainText;
  return plainText.substring(0, length) + '...';
}

/**
 * Step 2: Parse & Metadata extraction
 */
function parseAndMetadata() {
  const files = fs.readdirSync(MD_DIR).filter(file => file.endsWith('.md'));
  
  const posts = files.map(file => {
    const rawContent = fs.readFileSync(path.join(MD_DIR, file), 'utf-8');
    const { data, content } = matter(rawContent);
    
    const htmlContent = marked.parse(content);
    const slug = file.replace('.md', '');
    const excerpt = createExcerpt(htmlContent, config.excerptLength);

    return {
      title: data.title || 'Untitled Post',
      date: new Date(data.date || Date.now()),
      slug,
      content: htmlContent,
      excerpt,
      metaTitle: data.metaTitle || `${data.title || 'Untitled'} | ${config.blogName}`,
      metaDescription: data.description || excerpt
    };
  });

  return posts.sort((a, b) => b.date - a.date);
}

/**
 * Helper: Replaces custom {{tags}} inside templates
 */
function replacePlaceholders(templateStr, replacements = {}) {
  let output = templateStr;
  Object.entries(replacements).forEach(([key, val]) => {
    output = output.replace(new RegExp(`{{${key}}}`, 'g'), val);
  });
  return output;
}

/**
 * Helper: Assembles pages by dynamically rendering the header with metadata
 */
function assemblePage(templateName, metaTitle, metaDescription, dynamicReplacements = {}) {
  const rawHeader = fs.readFileSync(path.join(TEMPLATES_DIR, 'header.html'), 'utf-8');
  const footer = fs.readFileSync(path.join(TEMPLATES_DIR, 'footer.html'), 'utf-8');
  const bodyTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, `${templateName}.html`), 'utf-8');

  // Renders header metadata placeholders dynamically 
  const header = replacePlaceholders(rawHeader, {
    blogName: config.blogName,
    metaTitle,
    metaDescription
  });

  // Glue base layouts
  let merged = bodyTemplate
    .replace('{{header}}', header)
    .replace('{{footer}}', footer)
    .replace(/{{blogName}}/g, config.blogName);

  return replacePlaceholders(merged, dynamicReplacements);
}

/**
 * Step 3: Generate Individual Pages
 */
function generateIndividualPages(posts) {
  posts.forEach(post => {
    // Passes post metadata specifically down to the layout engine
    const pageHtml = assemblePage('post', post.metaTitle, post.metaDescription, {
      postTitle: post.title,
      postDate: post.date.toLocaleDateString(),
      postContent: post.content
    });
    
    fs.writeFileSync(path.join(POSTS_DIST_DIR, `${post.slug}.html`), pageHtml);
  });
}

/**
 * Step 4: Generate Paginated Index Pages
 */
function generateIndices(posts) {
  const totalPages = Math.ceil(posts.length / config.blogsPerPage);
  
  if (totalPages === 0) {
    const emptyHtml = assemblePage(
      'index', 
      config.blogName, 
      `Welcome to ${config.blogName}`, 
      { postsList: '<p>No posts yet.</p>', pagination: '' }
    );
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), emptyHtml);
    return;
  }

  const excerptTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'excerpt.html'), 'utf-8');
  const paginationTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'pagination.html'), 'utf-8');

  for (let i = 0; i < totalPages; i++) {
    const pageNum = i + 1;
    const startIndex = i * config.blogsPerPage;
    const pagePosts = posts.slice(startIndex, startIndex + config.blogsPerPage);

    // 1. Generate lists of excerpts
    let postsListHtml = '';
    pagePosts.forEach(post => {
      postsListHtml += replacePlaceholders(excerptTemplate, {
        postSlug: post.slug,
        postTitle: post.title,
        postDate: post.date.toLocaleDateString(),
        postExcerpt: post.excerpt
      });
    });

    // 2. Generate pagination variables
    const hasPrev = pageNum > 1;
    const hasNext = pageNum < totalPages;

    // "Newer" (Previous) link points to pageNum - 1
    const prevUrl = hasPrev ? (pageNum === 2 ? '/index.html' : `/index-${pageNum - 1}.html`) : '#';
    const prevClass = hasPrev ? '' : 'disabled';

    // "Older" (Next) link points to pageNum + 1
    const nextUrl = hasNext ? `/index-${pageNum + 1}.html` : '#';
    const nextClass = hasNext ? '' : 'disabled';

    const paginationHtml = replacePlaceholders(paginationTemplate, {
      prevUrl,
      prevClass,
      currentPage: pageNum.toString(),
      totalPages: totalPages.toString(),
      nextUrl,
      nextClass
    });

    // 3. Assemble and write index pages
    const indexTitle = pageNum === 1 ? config.blogName : `Page ${pageNum} | ${config.blogName}`;
    const indexDesc = `Articles and writeups - page ${pageNum} of ${totalPages}`;

    const indexHtml = assemblePage('index', indexTitle, indexDesc, {
      postsList: postsListHtml,
      pagination: paginationHtml
    });

    const fileName = pageNum === 1 ? 'index.html' : `index-${pageNum}.html`;
    fs.writeFileSync(path.join(DIST_DIR, fileName), indexHtml);
  }
}

/**
 * Orchestrator Execution Pipeline
 */
function runBuild() {
  console.log('Starting static site build...');
  
  cleanAndInitialize();
  const sortedPosts = parseAndMetadata();
  generateIndividualPages(sortedPosts);
  generateIndices(sortedPosts);
  
  console.log('Build complete! Check your /dist directory.');
}

runBuild();
