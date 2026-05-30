namespace Sinco.Server.Helpers
{
    public class ExceptionFormat : Exception
    {
        public int? Code { get; set; }
        public List<string> Errors { get; set; }
        public ExceptionFormat(string message) : base(message)
        {
            Errors = new List<string>() { message };
        }
        //public ExceptionFormat(string title , List<string> errors) : base(title)
        //{
        //	if ( errors == null || errors.Count == 0 )
        //	{
        //		Errors = new List<string> { title };
        //	}
        //	else
        //	{
        //		Errors = errors.Select(error => $"{title} {error}").ToList();
        //	}
        //}
        public ExceptionFormat(int? code, string title, List<string> errors)
        : base(errors == null || errors.Count == 0
        ? title
        : title + ":" + Environment.NewLine + string.Join(Environment.NewLine, errors))
        {
            Code = code ?? null;

            if (errors == null || errors.Count == 0)
            {
                Errors = new List<string> { title };
            }
            else
            {
                // Nếu muốn mỗi lỗi có kèm title
                Errors = errors.Select(error => $"{title} {error}").ToList();
            }
        }

    }
}
